// Persistence of configs (one row per kind + id) and the local sealer key
// pair. Two implementations with the same semantics: Postgres (tables from
// migrations/20261104120000_add_adapter_configs.sql) and an in-process one
// for adapters without a DB and for tests.
//
// Secrets reach this layer already sealed; nothing here opens, logs or
// rewrites them. Error messages only ever carry kinds and ids.
import { Pool, PoolClient } from 'pg';
import {
  ConfigRef, ConfigStore, KeyStore, SaveConfigInput, StoredConfig,
} from './interfaces';
import {
  ConfigKind, ERROR_CODES, SealedValues, ConfigValues,
} from './types';
import { assertValidPostgresIdentifier } from '../storage/config';

type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

/** Error with a stable `code` (ERROR_CODES.notFound) for callers to map. */
export class ConfigStoreError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'ConfigStoreError';
  }
}

export const isConfigStoreError = (e: unknown): e is ConfigStoreError => e instanceof ConfigStoreError;

const notFound = (ref: ConfigRef) => new ConfigStoreError(ERROR_CODES.notFound, `config ${ref.kind}/${ref.id} not found`);

interface ConfigRow {
  kind: ConfigKind;
  id: string;
  name: string;
  is_default: boolean;
  version: number;
  values: ConfigValues;
  secrets: SealedValues;
  actor: string | null;
  updated_at: Date;
}

const toStored = (row: ConfigRow): StoredConfig => ({
  kind: row.kind,
  id: row.id,
  name: row.name,
  isDefault: row.is_default,
  version: row.version,
  values: row.values ?? {},
  secrets: row.secrets ?? {},
  actor: row.actor ?? undefined,
  updatedAt: row.updated_at,
});

export class PgConfigStore implements ConfigStore, KeyStore {
  private readonly schema: string;

  constructor(private pool: Pool, schemaName: string) {
    assertValidPostgresIdentifier(schemaName);
    this.schema = schemaName;
  }

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // ---- ConfigStore ----

  async list(): Promise<StoredConfig[]> {
    const res = await this.pool.query<ConfigRow>(
      `SELECT * FROM ${this.schema}.adapter_configs ORDER BY created_at, kind, id`,
    );
    return res.rows.map(toStored);
  }

  async get(ref: ConfigRef): Promise<StoredConfig | undefined> {
    const res = await this.pool.query<ConfigRow>(
      `SELECT * FROM ${this.schema}.adapter_configs WHERE kind = $1 AND id = $2`,
      [ref.kind, ref.id],
    );
    return res.rows.length > 0 ? toStored(res.rows[0]) : undefined;
  }

  async save(input: SaveConfigInput): Promise<number> {
    return this.transaction(async (client) => {
      if (input.isDefault) {
        // Partial unique index allows a single default per kind; clear the others first.
        await client.query(
          `UPDATE ${this.schema}.adapter_configs SET is_default = FALSE WHERE kind = $1 AND is_default AND id <> $2`,
          [input.kind, input.id],
        );
      }
      const res = await client.query<{ version: number }>(
        `INSERT INTO ${this.schema}.adapter_configs (kind, id, name, is_default, version, "values", secrets, actor)
         VALUES ($1, $2, $3, $4, 1, $5, $6, $7)
         ON CONFLICT (kind, id) DO UPDATE SET
           name = EXCLUDED.name,
           is_default = EXCLUDED.is_default,
           "values" = EXCLUDED."values",
           secrets = EXCLUDED.secrets,
           actor = EXCLUDED.actor,
           version = ${this.schema}.adapter_configs.version + 1,
           updated_at = now()
         RETURNING version`,
        [
          input.kind,
          input.id,
          input.name,
          input.isDefault,
          JSON.stringify(input.values),
          JSON.stringify(input.secrets),
          input.actor ?? null,
        ],
      );
      return res.rows[0].version;
    });
  }

  async remove(ref: ConfigRef): Promise<void> {
    const res = await this.pool.query(
      `DELETE FROM ${this.schema}.adapter_configs WHERE kind = $1 AND id = $2`,
      [ref.kind, ref.id],
    );
    if (res.rowCount === 0) throw notFound(ref);
  }

  // ---- KeyStore ----

  async loadKey(): Promise<{ kid: string; privateKeyPem: string; publicKeySpki: string } | undefined> {
    const res = await this.pool.query<{ kid: string; private_key_pem: string; public_key_spki: string }>(
      `SELECT kid, private_key_pem, public_key_spki FROM ${this.schema}.adapter_keys
       ORDER BY created_at DESC, kid DESC LIMIT 1`,
    );
    const row = res.rows.at(0);
    if (!row) return undefined;
    return { kid: row.kid, privateKeyPem: row.private_key_pem, publicKeySpki: row.public_key_spki };
  }

  async saveKey(key: { kid: string; privateKeyPem: string; publicKeySpki: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.adapter_keys (kid, private_key_pem, public_key_spki)
       VALUES ($1, $2, $3)
       ON CONFLICT (kid) DO UPDATE SET
         private_key_pem = EXCLUDED.private_key_pem,
         public_key_spki = EXCLUDED.public_key_spki`,
      [key.kid, key.privateKeyPem, key.publicKeySpki],
    );
  }
}

const keyOf = (ref: ConfigRef): string => `${ref.kind}/${ref.id}`;

/**
 * In-process store with the same semantics as PgConfigStore. State is lost
 * on restart; sealed secrets kept here are still only openable by the sealer.
 */
export class MemoryConfigStore implements ConfigStore, KeyStore {
  // Map keeps insertion order, which stands in for created_at ordering.
  private configs = new Map<string, StoredConfig>();

  private keys: Array<{ kid: string; privateKeyPem: string; publicKeySpki: string }> = [];

  private static clone(c: StoredConfig): StoredConfig {
    return {
      ...c,
      values: { ...c.values },
      secrets: JSON.parse(JSON.stringify(c.secrets)),
    };
  }

  async list(): Promise<StoredConfig[]> {
    return [...this.configs.values()].map(MemoryConfigStore.clone);
  }

  async get(ref: ConfigRef): Promise<StoredConfig | undefined> {
    const c = this.configs.get(keyOf(ref));
    return c ? MemoryConfigStore.clone(c) : undefined;
  }

  async save(input: SaveConfigInput): Promise<number> {
    if (input.isDefault) {
      for (const c of this.configs.values()) {
        if (c.kind === input.kind && c.id !== input.id) c.isDefault = false;
      }
    }
    const existing = this.configs.get(keyOf(input));
    const version = existing ? existing.version + 1 : 1;
    this.configs.set(keyOf(input), {
      kind: input.kind,
      id: input.id,
      name: input.name,
      isDefault: input.isDefault,
      version,
      values: { ...input.values },
      secrets: JSON.parse(JSON.stringify(input.secrets)),
      actor: input.actor,
      updatedAt: new Date(),
    });
    return version;
  }

  async remove(ref: ConfigRef): Promise<void> {
    if (!this.configs.delete(keyOf(ref))) throw notFound(ref);
  }

  async loadKey(): Promise<{ kid: string; privateKeyPem: string; publicKeySpki: string } | undefined> {
    const k = this.keys.at(-1);
    return k ? { ...k } : undefined;
  }

  async saveKey(key: { kid: string; privateKeyPem: string; publicKeySpki: string }): Promise<void> {
    this.keys = this.keys.filter((k) => k.kid !== key.kid);
    this.keys.push({ ...key });
  }
}

// Persistence of the config document (1 row, table adapter_config) and of the
// local sealer key pair (adapter_keys). Postgres (migrations/
// 20261122120000_add_adapter_config.sql) and an in-process version with the
// same semantics, for adapters without a DB and for tests.
//
// Secret values reach this layer already sealed; nothing here opens, logs or
// rewrites them.
import { Pool } from 'pg';
import { ConfigStore, KeyStore, SaveConfigInput, StoredConfig } from './interfaces';
import { assertValidPostgresIdentifier } from '../storage/config';

interface ConfigRow {
  version: string;
  revision: number;
  config: { ledgers?: StoredConfig['ledgers']; custody?: StoredConfig['custody'] };
  actor: string | null;
  updated_at: Date;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class PgConfigStore implements ConfigStore, KeyStore {
  private readonly schema: string;

  constructor(private pool: Pool, schemaName: string) {
    assertValidPostgresIdentifier(schemaName);
    this.schema = schemaName;
  }

  async load(): Promise<StoredConfig | undefined> {
    const res = await this.pool.query<ConfigRow>(
      `SELECT version, revision, config, actor, updated_at FROM ${this.schema}.adapter_config WHERE id = 'default'`,
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return {
      version: row.version,
      revision: row.revision,
      ledgers: row.config.ledgers ?? {},
      ...(row.config.custody ? { custody: row.config.custody } : {}),
      actor: row.actor ?? undefined,
      updatedAt: row.updated_at,
    };
  }

  async save(input: SaveConfigInput): Promise<number> {
    const config = { ledgers: input.ledgers, ...(input.custody ? { custody: input.custody } : {}) };
    const res = await this.pool.query<{ revision: number }>(
      `INSERT INTO ${this.schema}.adapter_config (id, version, revision, config, actor)
       VALUES ('default', $1, 1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         version = EXCLUDED.version,
         revision = ${this.schema}.adapter_config.revision + 1,
         config = EXCLUDED.config,
         actor = EXCLUDED.actor,
         updated_at = now()
       RETURNING revision`,
      [input.version, JSON.stringify(config), input.actor ?? null],
    );
    return res.rows[0].revision;
  }

  async loadKey(): Promise<{ kid: string; privateKeyPem: string; publicKeySpki: string } | undefined> {
    const res = await this.pool.query<{ kid: string; private_key_pem: string; public_key_spki: string }>(
      `SELECT kid, private_key_pem, public_key_spki FROM ${this.schema}.adapter_keys
       ORDER BY created_at DESC, kid DESC LIMIT 1`,
    );
    const row = res.rows[0];
    return row ? { kid: row.kid, privateKeyPem: row.private_key_pem, publicKeySpki: row.public_key_spki } : undefined;
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

/** In-process store with the same semantics as PgConfigStore. State is lost on restart. */
export class MemoryConfigStore implements ConfigStore, KeyStore {
  private doc: StoredConfig | undefined;

  private key: { kid: string; privateKeyPem: string; publicKeySpki: string } | undefined;

  async load(): Promise<StoredConfig | undefined> {
    return this.doc ? clone(this.doc) : undefined;
  }

  async save(input: SaveConfigInput): Promise<number> {
    const revision = (this.doc?.revision ?? 0) + 1;
    this.doc = { ...clone(input), revision, updatedAt: new Date() };
    return revision;
  }

  async loadKey(): Promise<{ kid: string; privateKeyPem: string; publicKeySpki: string } | undefined> {
    return this.key ? { ...this.key } : undefined;
  }

  async saveKey(key: { kid: string; privateKeyPem: string; publicKeySpki: string }): Promise<void> {
    this.key = { ...key };
  }
}

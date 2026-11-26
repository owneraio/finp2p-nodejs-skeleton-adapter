import type { Pool } from 'pg';
import { assertValidPostgresIdentifier } from '../../storage/config';
import { Keyring } from '../../storage/encryption/keyring';
import { KeyringProtector, ValueProtector } from './protector';
import { AppliedConfig, ConfigBackend } from './store';

const VALUE = 'adapter_config_values.value';
const APPLIED = 'adapter_config_applied.field_values';

/**
 * The configuration in the adapter's Postgres schema (the tables of the
 * skeleton's `add_adapter_config` migration), every value sealed by the
 * protector, secrets and plain fields alike: each written value by field id,
 * and the applied version with its values, the current one only, so a
 * replaced secret is not kept. A keyring is taken as its protector. Without
 * the key the rows are opaque; with a wrong one they fail to open rather than
 * read wrong.
 */
export class PgConfigBackend implements ConfigBackend {
  private readonly protector: ValueProtector;

  constructor(private readonly pool: Pool, private readonly schema: string, protector: ValueProtector | Keyring) {
    assertValidPostgresIdentifier(schema);
    this.protector = protector instanceof Keyring ? new KeyringProtector(protector) : protector;
  }

  async load() {
    const values = new Map<string, string>();
    const { rows } = await this.pool.query<{ field_id: string; value: string }>(`SELECT field_id, value FROM ${this.schema}.adapter_config_values`);
    for (const row of rows) values.set(row.field_id, await this.protector.open(row.value, VALUE));
    const current = await this.pool.query<{ version: number; applied_at: Date | string; field_values: string }>(
      `SELECT version, applied_at, field_values FROM ${this.schema}.adapter_config_applied`,
    );
    const applied = current.rows[0];
    return {
      values,
      applied: applied && {
        version: applied.version,
        appliedAt: new Date(applied.applied_at).toISOString(),
        fieldValues: JSON.parse(await this.protector.open(applied.field_values, APPLIED)) as Record<string, string>,
      },
    };
  }

  async put(fieldId: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.adapter_config_values (field_id, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (field_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [fieldId, await this.protector.seal(value, VALUE)],
    );
  }

  async get(fieldId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ value: string }>(`SELECT value FROM ${this.schema}.adapter_config_values WHERE field_id = $1`, [fieldId]);
    return rows[0] ? this.protector.open(rows[0].value, VALUE) : undefined;
  }

  async remove(fieldId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.schema}.adapter_config_values WHERE field_id = $1`, [fieldId]);
  }

  /** Replaces the applied version: one row, so the values of an earlier version, secrets included, are gone. */
  async saveApplied(applied: AppliedConfig, fieldValues: Record<string, string>): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.adapter_config_applied (id, version, applied_at, field_values) VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = EXCLUDED.applied_at, field_values = EXCLUDED.field_values`,
      [applied.version, applied.appliedAt, await this.protector.seal(JSON.stringify(fieldValues), APPLIED)],
    );
  }
}

/** The configuration in memory, for tests and a deployment without a database: a restart forgets it. */
export class MemoryConfigBackend implements ConfigBackend {
  readonly values = new Map<string, string>();

  applied: (AppliedConfig & { fieldValues: Record<string, string> }) | undefined;

  async load() {
    return { values: new Map(this.values), ...(this.applied ? { applied: { ...this.applied, fieldValues: { ...this.applied.fieldValues } } } : {}) };
  }

  async put(fieldId: string, value: string): Promise<void> { this.values.set(fieldId, value); }

  async get(fieldId: string): Promise<string | undefined> { return this.values.get(fieldId); }

  async remove(fieldId: string): Promise<void> { this.values.delete(fieldId); }

  async saveApplied(applied: AppliedConfig, fieldValues: Record<string, string>): Promise<void> {
    this.applied = { ...applied, fieldValues: { ...fieldValues } };
  }
}

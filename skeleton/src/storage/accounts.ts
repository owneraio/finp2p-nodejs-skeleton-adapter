import { Pool } from 'pg';
import { AccountStore, Account } from './interfaces';
import { assertValidPostgresIdentifier } from '../workflows/migrator';

interface DbRow {
  fin_id: string;
  field_name: string;
  value: string;
}

function aggregateRows(rows: DbRow[]): Account[] {
  const map = new Map<string, Record<string, string>>();
  for (const row of rows) {
    let fields = map.get(row.fin_id);
    if (!fields) {
      fields = {};
      map.set(row.fin_id, fields);
    }
    fields[row.field_name] = row.value;
  }
  return Array.from(map.entries()).map(([finId, fields]) => ({ finId, fields }));
}

export class PgAccountStore implements AccountStore {
  constructor(private pool: Pool, private readonly schemaName: string) {
    // schemaName is interpolated into SQL (Postgres can't parameter-bind
    // identifiers); validate at construction to minimize injection risk.
    assertValidPostgresIdentifier(schemaName);
  }

  async getAccounts(finIds?: string[]): Promise<Account[]> {
    if (finIds && finIds.length > 0) {
      const result = await this.pool.query(
        `SELECT * FROM ${this.schemaName}.account_mappings WHERE fin_id = ANY($1) ORDER BY fin_id ASC, field_name ASC`,
        [finIds],
      );
      return aggregateRows(result.rows);
    }
    const result = await this.pool.query(
      `SELECT * FROM ${this.schemaName}.account_mappings ORDER BY fin_id ASC, field_name ASC`,
    );
    return aggregateRows(result.rows);
  }

  async getByFieldValue(fieldName: string, value: string): Promise<Account[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT am.* FROM ${this.schemaName}.account_mappings am
       WHERE am.fin_id IN (
         SELECT fin_id FROM ${this.schemaName}.account_mappings
         WHERE field_name = $1 AND value = $2
       )
       ORDER BY am.fin_id ASC, am.field_name ASC`,
      [fieldName, value],
    );
    return aggregateRows(result.rows);
  }

  async saveAccount(finId: string, fields: Record<string, string>): Promise<Account> {
    for (const [fieldName, value] of Object.entries(fields)) {
      await this.pool.query(
        `INSERT INTO ${this.schemaName}.account_mappings (fin_id, field_name, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (fin_id, field_name) DO UPDATE SET value = $3, updated_at = NOW()`,
        [finId, fieldName, value],
      );
    }
    return { finId, fields: { ...fields } };
  }

  async deleteAccount(finId: string, fieldName?: string): Promise<void> {
    if (fieldName) {
      await this.pool.query(
        `DELETE FROM ${this.schemaName}.account_mappings WHERE fin_id = $1 AND field_name = $2`,
        [finId, fieldName],
      );
    } else {
      await this.pool.query(
        `DELETE FROM ${this.schemaName}.account_mappings WHERE fin_id = $1`,
        [finId],
      );
    }
  }
}

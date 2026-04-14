import { Pool } from 'pg';

export interface OwnerMappingRow {
  finId: string;
  fields: Record<string, string>;
}

export interface AccountMappingStore {
  getOwnerMappings(finIds?: string[]): Promise<OwnerMappingRow[]>;
  getByFieldValue(fieldName: string, value: string): Promise<OwnerMappingRow[]>;
  saveOwnerMapping(finId: string, fields: Record<string, string>): Promise<OwnerMappingRow>;
  deleteOwnerMapping(finId: string, fieldName?: string): Promise<void>;
}

interface DbRow {
  fin_id: string;
  field_name: string;
  value: string;
}

function aggregateRows(rows: DbRow[]): OwnerMappingRow[] {
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

export class PgAccountMappingStore implements AccountMappingStore {
  constructor(private pool: Pool) {}

  async getOwnerMappings(finIds?: string[]): Promise<OwnerMappingRow[]> {
    if (finIds && finIds.length > 0) {
      const result = await this.pool.query(
        'SELECT * FROM ledger_adapter.account_mappings WHERE fin_id = ANY($1) ORDER BY fin_id ASC, field_name ASC',
        [finIds],
      );
      return aggregateRows(result.rows);
    }
    const result = await this.pool.query(
      'SELECT * FROM ledger_adapter.account_mappings ORDER BY fin_id ASC, field_name ASC',
    );
    return aggregateRows(result.rows);
  }

  async getByFieldValue(fieldName: string, value: string): Promise<OwnerMappingRow[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT am.* FROM ledger_adapter.account_mappings am
       WHERE am.fin_id IN (
         SELECT fin_id FROM ledger_adapter.account_mappings
         WHERE field_name = $1 AND value = $2
       )
       ORDER BY am.fin_id ASC, am.field_name ASC`,
      [fieldName, value.toLowerCase()],
    );
    return aggregateRows(result.rows);
  }

  async saveOwnerMapping(finId: string, fields: Record<string, string>): Promise<OwnerMappingRow> {
    const savedFields: Record<string, string> = {};
    for (const [fieldName, rawValue] of Object.entries(fields)) {
      const value = rawValue.toLowerCase();
      await this.pool.query(
        `INSERT INTO ledger_adapter.account_mappings (fin_id, field_name, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (fin_id, field_name) DO UPDATE SET value = $3, updated_at = NOW()`,
        [finId, fieldName, value],
      );
      savedFields[fieldName] = value;
    }
    return { finId, fields: savedFields };
  }

  async deleteOwnerMapping(finId: string, fieldName?: string): Promise<void> {
    if (fieldName) {
      await this.pool.query(
        'DELETE FROM ledger_adapter.account_mappings WHERE fin_id = $1 AND field_name = $2',
        [finId, fieldName],
      );
    } else {
      await this.pool.query(
        'DELETE FROM ledger_adapter.account_mappings WHERE fin_id = $1',
        [finId],
      );
    }
  }
}

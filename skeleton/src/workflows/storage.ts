import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { StorageConfig } from './config';
import bs58 from 'bs58';

export const generateCid = (): string => bs58.encode(Uint8Array.from(randomBytes(64)));

export interface Operation {
  cid: string;
  created_at: Date;
  updated_at: Date;
  method: string;
  status: 'in_progress' | 'succeeded' | 'failed';
  inputs: any;
  outputs: any;
}

export interface Asset {
  type: string;
  id: string;
  token_standard: 'ERC20';
  created_at: Date;
  updated_at: Date;
  contract_address: string;
  decimals: number;
}

export interface AccountMappingRow {
  fin_id: string;
  field_name: string;
  value: string;
  created_at: Date;
  updated_at: Date;
}

const cloneExcept = (obj: any, key: string): any => {
  const copy = { ...obj };
  delete copy[key];
  return copy;
};

function aggregateRows(rows: AccountMappingRow[]): { finId: string; fields: Record<string, string> }[] {
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

export class Storage {
  private c: Pool;

  constructor(config: StorageConfig) {
    this.c = new Pool({ connectionString: config.connectionString });
  }

  async closeConnections() {
    await this.c.end();
  }

  // ─── Operations ─────────────────────────────────────────────────

  async operation(cid: string): Promise<Operation | undefined> {
    const result = await this.c.query('SELECT * FROM ledger_adapter.operations WHERE cid = $1', [cid]);
    return result.rows.at(0);
  }

  async insert(
    ix: Omit<Operation, 'created_at' | 'updated_at'>,
  ): Promise<[Operation, boolean]> {
    const c = await this.c.query(
      `INSERT INTO ledger_adapter.operations (cid, method, status, inputs, outputs)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(method, inputs) DO UPDATE
      -- no-op
      SET inputs = ledger_adapter.operations.inputs
      RETURNING
        ledger_adapter.operations.*,
        (xmax = 0) AS __inserted;
      `,
      [
        ix.cid,
        ix.method,
        ix.status,
        JSON.stringify(ix.inputs),
        JSON.stringify(ix.outputs),
      ],
    );
    if (c.rows.length === 0)
      throw new Error('It seems like operation did not insert');

    return [
      cloneExcept(c.rows[0], '__inserted'),
      c.rows[0].__inserted,
    ];
  }

  async operationsAll(): Promise<Operation[]> {
    const result = await this.c.query('SELECT * FROM ledger_adapter.operations');
    return result.rows;
  }

  private async operations(opts: { status: Operation['status'], method: string }): Promise<Operation[]> {
    const result = await this.c.query('SELECT * FROM ledger_adapter.operations WHERE status = $1 AND method = $2;', [opts.status, opts.method]);
    return result.rows;
  }

  async getPendingOperations(method: string): Promise<Operation[]> {
    return this.operations({ method, status: 'in_progress' });
  }

  async getFailedOperations(method: string): Promise<Operation[]> {
    return this.operations({ method, status: 'failed' });
  }

  async getCompletedOperations(method: string): Promise<Operation[]> {
    return this.operations({ method, status: 'succeeded' });
  }

  async update(
    cid: string,
    status: Operation['status'],
    outputs: Operation['outputs'],
  ): Promise<Operation> {
    const result = await this.c.query(
      `UPDATE ledger_adapter.operations
      SET status = $1, outputs = $2, updated_at = NOW()
      WHERE cid = $3
      RETURNING *;`,
      [
        status, JSON.stringify(outputs), cid,
      ],
    );
    if (result.rows.length === 0)
      throw new Error('It seems like operation did not update');

    return result.rows[0];
  }

  async getOperation(inputs: Iterable<any>): Promise<Operation> {
    const serialized: any[] = [];
    for (const el of inputs) serialized.push(el);
    const result = await this.c.query('SELECT * FROM ledger_adapter.operations WHERE inputs = $1', [JSON.stringify(serialized)]);
    return result.rows.at(0);
  }

  async getReceiptOperation(receiptId: string): Promise<Operation | undefined> {
    const result = await this.c.query(
      `SELECT * FROM ledger_adapter.operations
       WHERE outputs @> jsonb_build_object('receipt', jsonb_build_object('id', $1::text))
       LIMIT 1;`,
      [receiptId],
    );
    return result.rows.at(0);
  }

  // ─── Assets ─────────────────────────────────────────────────────

  async getAsset(asset: { id: string, type: string }): Promise<Asset | undefined> {
    const result = await this.c.query('SELECT * FROM ledger_adapter.assets WHERE id = $1 AND type = $2', [asset.id, asset.type]);
    return result.rows.at(0);
  }

  async saveAsset(asset: Omit<Asset, 'created_at' | 'updated_at'>): Promise<Asset> {
    const result = await this.c.query(
      `INSERT INTO ledger_adapter.assets (id, type, contract_address, decimals, token_standard)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;`,
      [
        asset.id,
        asset.type,
        asset.contract_address,
        asset.decimals,
        asset.token_standard,
      ],
    );
    if (result.rows.length === 0) throw new Error('Failed to save asset to DB');
    return result.rows.at(0);
  }

  // ─── Account Mappings ───────────────────────────────────────────

  async getAccountMappings(finIds?: string[]): Promise<{ finId: string; fields: Record<string, string> }[]> {
    if (finIds && finIds.length > 0) {
      const result = await this.c.query(
        'SELECT * FROM ledger_adapter.account_mappings WHERE fin_id = ANY($1) ORDER BY fin_id ASC, field_name ASC',
        [finIds],
      );
      return aggregateRows(result.rows);
    }
    const result = await this.c.query(
      'SELECT * FROM ledger_adapter.account_mappings ORDER BY fin_id ASC, field_name ASC',
    );
    return aggregateRows(result.rows);
  }

  async getAccountMappingsByFieldValue(fieldName: string, value: string): Promise<{ finId: string; fields: Record<string, string> }[]> {
    const result = await this.c.query(
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

  async saveAccountMapping(finId: string, fields: Record<string, string>): Promise<{ finId: string; fields: Record<string, string> }> {
    const savedFields: Record<string, string> = {};
    for (const [fieldName, rawValue] of Object.entries(fields)) {
      const value = rawValue.toLowerCase();
      await this.c.query(
        `INSERT INTO ledger_adapter.account_mappings (fin_id, field_name, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (fin_id, field_name) DO UPDATE SET value = $3, updated_at = NOW()`,
        [finId, fieldName, value],
      );
      savedFields[fieldName] = value;
    }
    return { finId, fields: savedFields };
  }

  async deleteAccountMapping(finId: string, fieldName?: string): Promise<void> {
    if (fieldName) {
      await this.c.query(
        'DELETE FROM ledger_adapter.account_mappings WHERE fin_id = $1 AND field_name = $2',
        [finId, fieldName],
      );
    } else {
      await this.c.query(
        'DELETE FROM ledger_adapter.account_mappings WHERE fin_id = $1',
        [finId],
      );
    }
  }
}

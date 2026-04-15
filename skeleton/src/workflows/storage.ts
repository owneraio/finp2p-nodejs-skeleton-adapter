import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
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

const cloneExcept = (obj: any, key: string): any => {
  const copy = { ...obj };
  delete copy[key];
  return copy;
};

/**
 * Workflow operation storage — handles idempotent async operations,
 * crash recovery, and status tracking.
 */
export class WorkflowStorage {
  constructor(private pool: Pool) {}

  async operation(cid: string): Promise<Operation | undefined> {
    const result = await this.pool.query('SELECT * FROM ledger_adapter.operations WHERE cid = $1', [cid]);
    return result.rows.at(0);
  }

  async insert(
    ix: Omit<Operation, 'created_at' | 'updated_at'>,
  ): Promise<[Operation, boolean]> {
    const c = await this.pool.query(
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
    const result = await this.pool.query('SELECT * FROM ledger_adapter.operations');
    return result.rows;
  }

  private async operations(opts: { status: Operation['status'], method: string }): Promise<Operation[]> {
    const result = await this.pool.query('SELECT * FROM ledger_adapter.operations WHERE status = $1 AND method = $2;', [opts.status, opts.method]);
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
    const result = await this.pool.query(
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
    const result = await this.pool.query('SELECT * FROM ledger_adapter.operations WHERE inputs = $1', [JSON.stringify(serialized)]);
    return result.rows.at(0);
  }

  async getReceiptOperation(receiptId: string): Promise<Operation | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ledger_adapter.operations
       WHERE outputs @> jsonb_build_object('receipt', jsonb_build_object('id', $1::text))
       LIMIT 1;`,
      [receiptId],
    );
    return result.rows.at(0);
  }
}

import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import bs58 from 'bs58';
import { assertValidSchemaName, DEFAULT_SCHEMA_NAME } from '../storage/config';

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
 *
 * The schema name (qualifying the `operations` table) is configurable so
 * multiple adapters can share a database without colliding on the same
 * `ledger_adapter` schema.
 */
export class WorkflowStorage {
  private readonly schema: string;

  constructor(private pool: Pool, schemaName: string = DEFAULT_SCHEMA_NAME) {
    assertValidSchemaName(schemaName);
    this.schema = schemaName;
  }

  async getOperations(): Promise<Operation[]> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.operations`);
    return result.rows;
  }

  async getOperationByCid(cid: string): Promise<Operation | undefined> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.operations WHERE cid = $1`, [cid]);
    return result.rows.at(0);
  }

  async getOperationByInputs(inputs: Iterable<any>): Promise<Operation | undefined> {
    const serialized: any[] = [];
    for (const el of inputs) serialized.push(el);
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.operations WHERE inputs = $1`, [JSON.stringify(serialized)]);
    return result.rows.at(0);
  }

  async getOperationByReceiptId(receiptId: string): Promise<Operation | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.operations
       WHERE outputs @> jsonb_build_object('receipt', jsonb_build_object('id', $1::text))
       LIMIT 1;`,
      [receiptId],
    );
    return result.rows.at(0);
  }

  async getPendingOperations(method: string): Promise<Operation[]> {
    return this.getOperationsByMethodAndStatus(method, 'in_progress');
  }

  async getFailedOperations(method: string): Promise<Operation[]> {
    return this.getOperationsByMethodAndStatus(method, 'failed');
  }

  async getCompletedOperations(method: string): Promise<Operation[]> {
    return this.getOperationsByMethodAndStatus(method, 'succeeded');
  }

  private async getOperationsByMethodAndStatus(method: string, status: Operation['status']): Promise<Operation[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.operations WHERE status = $1 AND method = $2;`,
      [status, method],
    );
    return result.rows;
  }

  async saveOperation(
    ix: Omit<Operation, 'created_at' | 'updated_at'>,
  ): Promise<[Operation, boolean]> {
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.operations (cid, method, status, inputs, outputs)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(method, inputs) DO UPDATE
      -- no-op
      SET inputs = ${this.schema}.operations.inputs
      RETURNING
        ${this.schema}.operations.*,
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
    if (result.rows.length === 0)
      throw new Error('It seems like operation did not save');

    return [
      cloneExcept(result.rows[0], '__inserted'),
      result.rows[0].__inserted,
    ];
  }

  async completeOperation(
    cid: string,
    status: Operation['status'],
    outputs: Operation['outputs'],
  ): Promise<Operation> {
    const result = await this.pool.query(
      `UPDATE ${this.schema}.operations
      SET status = $1, outputs = $2, updated_at = NOW()
      WHERE cid = $3
      RETURNING *;`,
      [
        status, JSON.stringify(outputs), cid,
      ],
    );
    if (result.rows.length === 0)
      throw new Error('It seems like operation did not complete');

    return result.rows[0];
  }
}

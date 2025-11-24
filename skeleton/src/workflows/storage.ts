import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { StorageConfig } from './config';

export const generateCid = (): string => randomBytes(64).toString('base64');

export interface Operation {
  cid: string;
  created_at: Date;
  updated_at: Date;
  method: string;
  status: 'in_progress' | 'succeeded' | 'failed';
  inputs: any;
  outputs: any;
}

const openConnections = [] as WeakRef<Pool>[];

const cloneExcept = (obj: any, key: string): any => {
  const copy = { ...obj }
  delete copy[key]
  return copy
}

export class Storage {
  private c: Pool;

  constructor(config: StorageConfig) {
    this.c = new Pool({ connectionString: config.connectionString });
    openConnections.push(new WeakRef(this.c));
  }

  static async closeAllConnections() {
    for (let weakRef of openConnections) {
      await (weakRef.deref()?.end() ?? Promise.resolve());
    }
  }

  async closeConnections() {
    await this.c.end();
  }

  async operation(cid: string): Promise<Operation | undefined> {
    const result = await this.c.query('SELECT * FROM finp2p_nodejs_skeleton.operations WHERE cid = $1', [cid]);
    return result.rows.at(0);
  }

  async insert(
    ix: Omit<Operation, 'created_at' | 'updated_at'>,
  ): Promise<[Operation, boolean]> {
    const c = await this.c.query(
      `INSERT INTO finp2p_nodejs_skeleton.operations (cid, method, status, inputs, outputs)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(inputs) DO UPDATE
      -- no-op
      SET inputs = finp2p_nodejs_skeleton.operations.inputs
      RETURNING
        finp2p_nodejs_skeleton.operations.*,
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
      cloneExcept(c.rows[0], "__inserted"),
      c.rows[0].__inserted
    ]
  }

  async operationsAll(): Promise<Operation[]> {
    const result = await this.c.query('SELECT * FROM finp2p_nodejs_skeleton.operations');
    return result.rows;
  }

  async update(
    cid: string,
    status: Operation['status'],
    outputs: Operation['outputs'],
  ): Promise<Operation> {
    const result = await this.c.query(
      `UPDATE finp2p_nodejs_skeleton.operations
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
}

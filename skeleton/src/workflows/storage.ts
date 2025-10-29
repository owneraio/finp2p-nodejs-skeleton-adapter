import knex from 'knex';
import { WorkflowStorageConfig } from './config';

export interface Operation {
  cid: string;
  created_at: Date;
  updated_at: Date;
  idempotency_key: string;
  method: string;
  status: 'in_progress' | 'succeeded' | 'failed' | 'queued' | 'unknown';
  inputs: any;
  outputs: any;
}

export class WorkflowStorage {
  private k: knex.Knex;

  constructor(config: WorkflowStorageConfig) {
    this.k = knex({ client: 'pg', connection: config.connectionString });
  }

  private tableOperations() {
    return this.k<Operation>('operations');
  }

  async operation(cid: string): Promise<Operation | undefined> {
    return this.tableOperations().where('cid', cid).first();
  }

  async insert(
    ix: Omit<Operation, 'cid' | 'created_at' | 'updated_at'>,
  ): Promise<Operation> {
    const c = await this.tableOperations().insert(ix, [
      'cid',
      'created_at',
      'updated_at',
    ]);
    if (c.length === 0)
      throw new Error('It seems like operation did not insert');
    return {
      ...ix,
      cid: c[0].cid,
      created_at: c[0].created_at,
      updated_at: c[0].updated_at,
    };
  }

  async operations(
    filter: Pick<Operation, 'status' | 'method'>,
  ): Promise<Operation[]> {
    return this.tableOperations().where(filter);
  }

  async update(
    cid: string,
    status: Operation['status'],
    outputs: Operation['outputs'],
  ): Promise<Operation> {
    const result = await this.tableOperations()
      .where('cid', cid)
      .update(
        {
          outputs,
          status,
          updated_at: this.k.fn.now(),
        },
        '*',
      );

    if (result.length === 0)
      throw new Error('It seems like operation did not update');

    return result[0];
  }
}

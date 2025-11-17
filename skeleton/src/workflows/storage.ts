import knex from 'knex';
import { StorageConfig } from './config';
import { randomBytes } from 'node:crypto';

export const generateCid = (): string => randomBytes(64).toString('base64');

export interface Operation {
  cid: string;
  created_at: Date;
  updated_at: Date;
  method: string;
  status: 'in_progress' | 'succeeded' | 'failed' | 'queued' | 'crashed' | 'unknown';
  inputs: any;
  outputs: any;
}

const openConnections = [] as WeakRef<knex.Knex>[];

export class WorkflowStorage {
  private k: knex.Knex;

  constructor(config: StorageConfig) {
    this.k = knex({ client: 'pg', connection: config.connectionString });
    openConnections.push(new WeakRef(this.k));
  }

  static async closeAllConnections() {
    for (let weakRef of openConnections) {
      await (weakRef.deref()?.destroy() ?? Promise.resolve());
    }
  }

  async closeConnections() {
    await this.k.destroy();
  }

  private tableOperations() {
    return this.k<Operation>('finp2p_nodejs_skeleton.operations');
  }

  async operation(cid: string): Promise<Operation | undefined> {
    return this.tableOperations().where('cid', cid).first();
  }

  async insert(
    ix: Omit<Operation,  'created_at' | 'updated_at'>,
  ): Promise<Operation> {
    const c = await this.tableOperations().insert(
      {
        ...ix,
        inputs: JSON.stringify(ix.inputs),
        outputs: JSON.stringify(ix.outputs),
        created_at: undefined,
        updated_at: undefined,
      }, [
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

  async operationsAll(): Promise<Operation[]> {
    return this.tableOperations().select();
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
          outputs: JSON.stringify(outputs),
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

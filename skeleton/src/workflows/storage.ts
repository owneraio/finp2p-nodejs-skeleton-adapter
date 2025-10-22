import knex from 'knex';

export interface Operation {
  id: number;
  cid: string | null;
  created_at: Date;
  updated_at: Date;
  idempotency_key: string;
  method: string;
  status: 'in_progress' | 'succeeded' | 'failed';
  arguments: any;
}

export class WorkflowStorage {
  private k: knex.Knex;

  constructor(config: { connectionString: string }) {
    this.k = knex({ client: 'pg', connection: config.connectionString });
  }

  private tableOperations() {
    return this.k<Operation>('operations');
  }

  async operation(cid: string): Promise<Operation | undefined> {
    return this.tableOperations().where('cid', cid).first();
  }

  async insert(
    ix: Omit<Operation, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Operation> {
    const c = await this.tableOperations().insert(ix, [
      'id',
      'created_at',
      'updated_at',
    ]);
    if (c.length === 0)
      throw new Error('It seems like operation did not insert');
    return {
      ...ix,
      id: c[0].id,
      created_at: c[0].created_at,
      updated_at: c[0].updated_at,
    };
  }

  async changeCid(id: number, cid: string | null): Promise<Operation> {
    const result = await this.tableOperations().where('id', id).update(
      {
        cid,
        updated_at: this.k.fn.now(),
      },
      '*',
    );

    if (result.length === 0)
      throw new Error('It seems like operation did not update');

    return result[0];
  }

  async operations(filter: Pick<Operation, 'status' | 'method'>): Promise<Operation[]> {
    return await this.tableOperations().where(filter)
  }

  async changeStatus(
    id: number,
    status: Operation['status'],
  ): Promise<Operation> {
    const result = await this.tableOperations().where('id', id).update(
      {
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

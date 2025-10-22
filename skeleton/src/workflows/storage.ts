import knex from "knex";

export interface Operation {
  id: number;
  cid: string;
  created_at: Date;
  updated_at: Date;
  idempotency_key: string;
  method: string;
  status: "in_progress" | "succeeded" | "failed";
  arguments: any;
}

export class WorkflowStorage {
  private k: knex.Knex;

  constructor(config: { connectionString: string }) {
    this.k = knex({ client: "pg", connection: config.connectionString });
  }

  private tableOperations() {
    return this.k<Operation>("operations");
  }

  async operation(cid: string): Promise<Operation | undefined> {
    return await this.tableOperations().where("cid", cid).first();
  }

  async insertWithCid(
    ix: Omit<Operation, "id" | "created_at" | "updated_at">
  ): Promise<Operation> {
    const c = await this.tableOperations().insert(ix, [
      "id",
      "created_at",
      "updated_at",
    ]);
    if (c.length === 0)
      throw new Error("It seems like instruction did not insert");
    return {
      ...ix,
      id: c[0].id,
      created_at: c[0].created_at,
      updated_at: c[0].updated_at,
    };
  }

  async insertAuto(
    ix: Omit<Operation, "id" | "cid" | "created_at" | "updated_at">
  ): Promise<Operation> {
    const c = await this.tableOperations().insert(ix, [
      "id",
      "cid",
      "created_at",
      "updated_at",
    ]);
    if (c.length === 0)
      throw new Error("It seems like instruction did not insert");
    return {
      ...ix,
      id: c[0].id,
      cid: c[0].cid,
      created_at: c[0].created_at,
      updated_at: c[0].updated_at,
    };
  }
}

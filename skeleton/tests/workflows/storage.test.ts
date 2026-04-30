import { migrateIfNeeded, WorkflowStorage } from "../../src/workflows";
import { expectDateToBeClose } from "../expectDateToBeClose";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { Pool } from "pg";

describe('Storage operations', () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let pool: Pool
  let storage = (): WorkflowStorage => { throw new Error('Not initialized yet') }
  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations",
      storageUser: container.storageUser
    })
    pool = new Pool({ connectionString: container.connectionString })
    const s = new WorkflowStorage(pool)
    storage = () => s
  })
  afterEach(async () => {
    await pool.end();
    await container.cleanup();
  });

  test("custom schema name flows through migrations and queries", async () => {
    // Spin up a second container just for this test so we can drive a
    // non-default schema and prove migrations land in the right place.
    // @ts-ignore
    const c = await global.startPostgresContainer();
    try {
      await migrateIfNeeded({
        connectionString: c.connectionString,
        // @ts-ignore
        gooseExecutablePath: await global.whichGoose(),
        migrationListTableName: "finp2p_nodejs_skeleton_migrations",
        storageUser: c.storageUser,
        schemaName: "my_adapter",
      });
      const customPool = new Pool({ connectionString: c.connectionString });
      try {
        const present = await customPool.query(
          "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'my_adapter'",
        );
        expect(present.rows).toHaveLength(1);
        const defaultAbsent = await customPool.query(
          "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ledger_adapter'",
        );
        expect(defaultAbsent.rows).toHaveLength(0);

        const customStorage = new WorkflowStorage(customPool, "my_adapter");
        const [row] = await customStorage.saveOperation({
          cid: "custom-1",
          inputs: { x: 1 },
          outputs: {},
          method: "noop",
          status: "in_progress",
        });
        expect(row.cid).toEqual("custom-1");
        const fetched = await customStorage.getOperationByCid("custom-1");
        expect(fetched?.cid).toEqual("custom-1");
      } finally {
        await customPool.end();
      }
    } finally {
      await c.cleanup();
    }
  });

  test("check autopopulation of optional fields", async () => {
    const ix = {
      cid: "123",
      inputs: { value: 32 },
      outputs: { signature: { tx: "hash" } },
      method: "nonExistent",
      status: "in_progress" as const,
    };
    const creationDate = new Date();

    const [row, inserted] = await storage().saveOperation(ix);
    expect(inserted).toBe(true);
    expect(row.cid).toEqual("123");
    expect(row.status).toEqual(ix.status);
    expect(row.inputs).toEqual({ value: 32 });
    expect(row.outputs).toEqual({ signature: { tx: "hash" } });
    expectDateToBeClose(row.created_at, creationDate);
    expectDateToBeClose(row.updated_at, creationDate);
  });

  test("providing optional fields may be reset", async () => {
    const ix = {
      inputs: { value: 32 },
      outputs: { signature: { tx: "hash" } },
      method: "nonExistent",
      status: "in_progress" as const,
      cid: "should be overriden",
      created_at: new Date(2000, 1, 2, 3, 4, 5),
      updated_at: new Date(1990, 1, 2, 3, 4, 5),
    };
    const creationDate = new Date();

    const [row, inserted] = await storage().saveOperation(ix);
    expect(inserted).toBe(true);
    expect(row.cid).toEqual("should be overriden");
    expect(row.status).toEqual(ix.status);
    expectDateToBeClose(row.created_at, creationDate);
    expectDateToBeClose(row.updated_at, creationDate);
  });

  test("updating row should autopopulate updated_at field but not created_at", async () => {
    const ix = {
      cid: Math.random().toString(),
      inputs: [ 32 ],
      outputs: { signature: { tx: "hash" } },
      method: "nonExistent",
      status: "in_progress" as const,
    };
    const creationDate = new Date();

    const [row, inserted] = await storage().saveOperation(ix);
    await setTimeoutPromise(20_000);

    const updateDate = new Date();
    const urow = await storage().completeOperation(row.cid, "failed", {
      assetBalance: { name: "USDC", value: 12345 },
    });

    expectDateToBeClose(row.created_at, urow.created_at);
    expectDateToBeClose(urow.updated_at, updateDate);
    expect(urow.status).toEqual("failed");
    expect(urow.outputs).toEqual({
      assetBalance: { name: "USDC", value: 12345 },
    });

    const grow = await storage().getOperationByCid(row.cid);
    expectDateToBeClose(row.created_at, urow.created_at);
    expectDateToBeClose(urow.updated_at, updateDate);
    expect(urow.status).toEqual("failed");
    expect(urow.outputs).toEqual({
      assetBalance: { name: "USDC", value: 12345 },
    });

    const globalGrow = await storage().getOperationByInputs([32])
    expect(globalGrow).toEqual(grow)
  });

  test("insert same inputs returns older CID", async () => {
    const [row1, inserted1] = await storage().saveOperation({
      cid: "cid-1",
      status: "in_progress",
      method: "approvePlan",
      inputs: ["idempotency-key-1", "plan-id-1"],
      outputs: {},
    });
    expect(inserted1).toBe(true);

    const [row2, inserted2] = await storage().saveOperation({
      cid: "cid-2",
      status: "in_progress",
      method: "approvePlan",
      inputs: ["idempotency-key-1", "plan-id-1"],
      outputs: {},
    });
    expect(inserted2).toBe(false);
    expect(row2.cid).not.toEqual("cid-2");
    expect(row2).toEqual(row1);
  });

  test("inserting and querying existing operations", async () => {
    const [row1, inserted1] = await storage().saveOperation({
      cid: "cid-1",
      inputs: ["idempotency-key1"],
      method: "method",
      outputs: {},
      status: "in_progress",
    });
    expect(inserted1).toBe(true);
    await expect(
      storage().getPendingOperations("method"),
    ).resolves.toEqual([row1]);
    await expect(
      storage().getFailedOperations("method"),
    ).resolves.toEqual([]);
    await expect(
      storage().getCompletedOperations("method"),
    ).resolves.toEqual([]);

    const updatedRow1 = await storage().completeOperation("cid-1", "succeeded", {
      value: 42,
    });
    await expect(
      storage().getPendingOperations("method"),
    ).resolves.toEqual([]);
    await expect(
      storage().getFailedOperations("method"),
    ).resolves.toEqual([]);
    await expect(
      storage().getCompletedOperations("method"),
    ).resolves.toEqual([updatedRow1]);

    const [row2, inserted2] = await storage().saveOperation({
      cid: "cid-2",
      inputs: ["idempotency-key2"],
      method: "method",
      outputs: {},
      status: "succeeded",
    });
    expect(inserted2).toBe(true);
    await expect(
      storage().getPendingOperations("method"),
    ).resolves.toEqual([]);
    await expect(
      storage().getFailedOperations("method"),
    ).resolves.toEqual([]);
    await expect(
      storage().getCompletedOperations("method"),
    ).resolves.toEqual([updatedRow1, row2]);
    await expect(
      storage().getCompletedOperations("unknown-method"),
    ).resolves.toEqual([]);
  });
});

import { migrateIfNeeded, Storage } from "../../src/workflows";
import { expectDateToBeClose } from "../expectDateToBeClose";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";

describe("Storage operations", () => {
  let container: { connectionString: string; cleanup: () => Promise<void> } = {
    connectionString: "",
    cleanup: () => Promise.resolve(),
  };
  let storage = (): Storage => {
    throw new Error("Not initialized yet");
  };
  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations",
    });
    const s = new Storage(container);
    storage = () => s;
  });
  afterEach(async () => {
    await storage().closeConnections();
    await container.cleanup();
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

    const [row, inserted] = await storage().insert(ix);
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

    const [row, inserted] = await storage().insert(ix);
    expect(inserted).toBe(true);
    expect(row.cid).toEqual("should be overriden");
    expect(row.status).toEqual(ix.status);
    expectDateToBeClose(row.created_at, creationDate);
    expectDateToBeClose(row.updated_at, creationDate);
  });

  test("updating row should autopopulate updated_at field but not created_at", async () => {
    const ix = {
      cid: Math.random().toString(),
      inputs: { value: 32 },
      outputs: { signature: { tx: "hash" } },
      method: "nonExistent",
      status: "in_progress" as const,
    };
    const creationDate = new Date();

    const [row, inserted] = await storage().insert(ix);
    await setTimeoutPromise(20_000);

    const updateDate = new Date();
    const urow = await storage().update(row.cid, "failed", {
      assetBalance: { name: "USDC", value: 12345 },
    });

    expectDateToBeClose(row.created_at, urow.created_at);
    expectDateToBeClose(urow.updated_at, updateDate);
    expect(urow.status).toEqual("failed");
    expect(urow.outputs).toEqual({
      assetBalance: { name: "USDC", value: 12345 },
    });

    const grow = await storage().operation(row.cid);
    expectDateToBeClose(row.created_at, urow.created_at);
    expectDateToBeClose(urow.updated_at, updateDate);
    expect(urow.status).toEqual("failed");
    expect(urow.outputs).toEqual({
      assetBalance: { name: "USDC", value: 12345 },
    });
  });

  test("insert same inputs returns older CID", async () => {
    const [row1, inserted1] = await storage().insert({
      cid: "cid-1",
      status: "in_progress",
      method: "approvePlan",
      inputs: ["idempotency-key-1", "plan-id-1"],
      outputs: {},
    });
    expect(inserted1).toBe(true);

    const [row2, inserted2] = await storage().insert({
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
    const [row1, inserted1] = await storage().insert({
      cid: "cid-1",
      inputs: ["idempotency-key1"],
      method: "method",
      outputs: {},
      status: "in_progress",
    });
    expect(inserted1).toBe(true);
    await expect(
      storage().operations({ status: "succeeded", method: "method" }),
    ).resolves.toEqual([]);
    await expect(
      storage().operations({ status: "failed", method: "method" }),
    ).resolves.toEqual([]);
    await expect(
      storage().operations({ status: "in_progress", method: "method" }),
    ).resolves.toEqual([row1]);

    const updatedRow1 = await storage().update("cid-1", "succeeded", {
      value: 42,
    });
    await expect(
      storage().operations({ status: "in_progress", method: "method" }),
    ).resolves.toEqual([]);
    await expect(
      storage().operations({ status: "failed", method: "method" }),
    ).resolves.toEqual([]);
    await expect(
      storage().operations({ status: "succeeded", method: "method" }),
    ).resolves.toEqual([updatedRow1]);

    const [row2, inserted2] = await storage().insert({
      cid: "cid-2",
      inputs: ["idempotency-key2"],
      method: "method",
      outputs: {},
      status: "succeeded",
    });
    expect(inserted2).toBe(true);
    await expect(
      storage().operations({ status: "in_progress", method: "method" }),
    ).resolves.toEqual([]);
    await expect(
      storage().operations({ status: "failed", method: "method" }),
    ).resolves.toEqual([]);
    await expect(
      storage().operations({ status: "succeeded", method: "method" }),
    ).resolves.toEqual([updatedRow1, row2]);
    await expect(
      storage().operations({ status: "succeeded", method: "unknown-method" }),
    ).resolves.toEqual([]);
  });
});

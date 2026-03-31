import {
  OperationStatus,
  successfulReceiptOperation,
} from "../../src/models";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import {
  createServiceProxy,
  migrateIfNeeded,
  Storage,
} from "../../src/workflows";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { MockFinP2PServer } from "../support/mock-finp2p-server";

let mockServer: MockFinP2PServer;
let finP2PClient: FinP2PClient;

beforeAll(async () => {
  mockServer = new MockFinP2PServer();
  const url = await mockServer.start();
  finP2PClient = new FinP2PClient(url, url);
});

afterAll(async () => {
  await mockServer.stop();
});

const fakeReceipt = (id: string) => ({
  id,
  asset: { assetId: "test-asset", assetType: "finp2p" as const },
  quantity: "100",
  timestamp: Date.now(),
  transactionDetails: {},
  tradeDetails: { executionContext: undefined },
  operationType: "issue",
} as any);

async function waitForStatus(
  storage: Storage,
  cid: string,
  targetStatus: "succeeded" | "failed",
  timeoutMs = 10_000,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const op = await storage.operation(cid);
    if (op && op.status === targetStatus) return op;
    await setTimeoutPromise(200);
  }
  throw new Error(`Operation ${cid} did not reach '${targetStatus}' within ${timeoutMs}ms`);
}

describe("Crash recovery tests", () => {
  let container: {
    connectionString: string;
    storageUser: string;
    cleanup: () => Promise<void>;
  } = {
    connectionString: "",
    storageUser: "",
    cleanup: () => Promise.resolve(),
  };
  let storage: Storage;

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations",
      storageUser: container.storageUser,
    });
    storage = new Storage(container);
  });

  afterEach(async () => {
    await storage.closeConnections();
    await container.cleanup();
  });

  test("operation started before crash is resumed on restart", async () => {
    const hangingService = {
      async issue(..._args: any[]): Promise<OperationStatus> {
        return new Promise(() => {}); // never resolves
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    const proxy1 = createServiceProxy(
      () => Promise.resolve(),
      storage,
      finP2PClient,
      hangingService,
      "issue",
    );

    const pendingResult = await proxy1.issue("idem-key-1", "asset-1", "user-1", "100");
    expect(pendingResult).toHaveProperty("correlationId");
    const cid = (pendingResult as any).correlationId;

    const op = await storage.operation(cid);
    expect(op!.status).toBe("in_progress");
    expect(op!.method).toBe("issue");
    expect(op!.inputs).toEqual(["idem-key-1", "asset-1", "user-1", "100"]);

    // --- "CRASH" — proxy1 is abandoned ---

    const recoveryCallCount = { issue: 0 };

    const recoveringService = {
      async issue(..._args: any[]): Promise<OperationStatus> {
        recoveryCallCount.issue++;
        return successfulReceiptOperation(fakeReceipt("receipt-recovered-1"));
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    const proxy2 = createServiceProxy(
      () => Promise.resolve(),
      storage,
      finP2PClient,
      recoveringService,
      "issue",
    );

    const recovered = await waitForStatus(storage, cid, "succeeded");
    expect(recovered.status).toBe("succeeded");
    expect(recovered.outputs.type).toBe("success");
    expect(recovered.outputs.receipt.id).toBe("receipt-recovered-1");
    expect(recoveryCallCount.issue).toBe(1);

    const statusResult = await proxy2.operationStatus(cid);
    expect(statusResult.type).toBe("success");

    const allOps = await storage.operationsAll();
    expect(allOps.length).toBe(1);
    const dbOp = allOps[0];
    expect(dbOp.cid).toBe(cid);
    expect(dbOp.method).toBe("issue");
    expect(dbOp.inputs).toEqual(["idem-key-1", "asset-1", "user-1", "100"]);
    expect(dbOp.updated_at.getTime()).toBeGreaterThanOrEqual(dbOp.created_at.getTime());
  });

  test("operation that fails on recovery is marked as failed", async () => {
    const [inserted] = await storage.insert({
      cid: "crash-cid-1",
      method: "issue",
      status: "in_progress",
      inputs: ["idem-fail", "asset-fail", "user-fail", "500"],
      outputs: {},
    });

    const failingService = {
      async issue(..._args: any[]): Promise<OperationStatus> {
        throw new Error("Ledger RPC connection refused");
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    createServiceProxy(
      () => Promise.resolve(),
      storage,
      finP2PClient,
      failingService,
      "issue",
    );

    const failed = await waitForStatus(storage, "crash-cid-1", "failed");
    expect(failed.status).toBe("failed");
    expect(JSON.stringify(failed.outputs)).toContain("Ledger RPC connection refused");

    const allOps = await storage.operationsAll();
    expect(allOps.length).toBe(1);
    const dbOp = allOps[0];
    expect(dbOp.cid).toBe("crash-cid-1");
    expect(dbOp.method).toBe("issue");
    expect(dbOp.inputs).toEqual(["idem-fail", "asset-fail", "user-fail", "500"]);
    expect(dbOp.updated_at.getTime()).toBeGreaterThanOrEqual(inserted.created_at.getTime());
  });

  test("callback is sent to router on successful recovery", async () => {
    await storage.insert({
      cid: "callback-cid-1",
      method: "issue",
      status: "in_progress",
      inputs: ["idem-cb", "asset-cb", "user-cb", "200"],
      outputs: {},
    });

    const service = {
      async issue(..._args: any[]): Promise<OperationStatus> {
        return successfulReceiptOperation(fakeReceipt("receipt-cb-1"));
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    createServiceProxy(
      () => Promise.resolve(),
      storage,
      finP2PClient,
      service,
      "issue",
    );

    await waitForStatus(storage, "callback-cid-1", "succeeded");
    await setTimeoutPromise(500); // let callback reach mock server

    const callback = mockServer.getCallback("callback-cid-1");
    expect(callback).toBeDefined();

    const allOps = await storage.operationsAll();
    expect(allOps.length).toBe(1);
    const dbOp = allOps[0];
    expect(dbOp.status).toBe("succeeded");
    expect(dbOp.inputs).toEqual(["idem-cb", "asset-cb", "user-cb", "200"]);
    expect(dbOp.outputs.receipt.id).toBe("receipt-cb-1");
  });

  test("multiple pending operations are all recovered", async () => {
    await storage.insert({
      cid: "multi-1", method: "transfer", status: "in_progress",
      inputs: ["idem-1", "asset-1", "from-1", "to-1", "100"], outputs: {},
    });
    await storage.insert({
      cid: "multi-2", method: "transfer", status: "in_progress",
      inputs: ["idem-2", "asset-2", "from-2", "to-2", "200"], outputs: {},
    });
    await storage.insert({
      cid: "multi-3", method: "transfer", status: "in_progress",
      inputs: ["idem-3", "asset-3", "from-3", "to-3", "300"], outputs: {},
    });

    const recoveredInputs: any[][] = [];

    const service = {
      async transfer(...args: any[]): Promise<OperationStatus> {
        recoveredInputs.push(args);
        return successfulReceiptOperation(fakeReceipt(`receipt-${args[0]}`));
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    createServiceProxy(
      () => Promise.resolve(),
      storage,
      finP2PClient,
      service,
      "transfer",
    );

    await waitForStatus(storage, "multi-1", "succeeded");
    await waitForStatus(storage, "multi-2", "succeeded");
    await waitForStatus(storage, "multi-3", "succeeded");

    expect(recoveredInputs.length).toBe(3);

    const allOps = await storage.operationsAll();
    expect(allOps.length).toBe(3);

    for (const [cid, idemKey, asset, from, to, qty] of [
      ["multi-1", "idem-1", "asset-1", "from-1", "to-1", "100"],
      ["multi-2", "idem-2", "asset-2", "from-2", "to-2", "200"],
      ["multi-3", "idem-3", "asset-3", "from-3", "to-3", "300"],
    ]) {
      const op = await storage.operation(cid);
      expect(op!.status).toBe("succeeded");
      expect(op!.method).toBe("transfer");
      expect(op!.inputs).toEqual([idemKey, asset, from, to, qty]);
      expect(op!.outputs.receipt.id).toBe(`receipt-${idemKey}`);
      expect(op!.updated_at.getTime()).toBeGreaterThanOrEqual(op!.created_at.getTime());
    }
  });

  test("already completed operations are not re-executed on restart", async () => {
    const [inserted] = await storage.insert({
      cid: "done-cid",
      method: "issue",
      status: "succeeded",
      inputs: ["idem-done", "asset-done", "user-done", "999"],
      outputs: { type: "success", receipt: { id: "already-done" } },
    });

    let callCount = 0;
    const service = {
      async issue(..._args: any[]): Promise<OperationStatus> {
        callCount++;
        return successfulReceiptOperation(fakeReceipt("should-not-happen"));
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    createServiceProxy(
      () => Promise.resolve(),
      storage,
      finP2PClient,
      service,
      "issue",
    );

    await setTimeoutPromise(2000);

    expect(callCount).toBe(0);
    const op = await storage.operation("done-cid");
    expect(op!.status).toBe("succeeded");
    expect(op!.outputs.receipt.id).toBe("already-done");

    const allOps = await storage.operationsAll();
    expect(allOps.length).toBe(1);
    expect(allOps[0].updated_at.getTime()).toBe(inserted.updated_at.getTime());
    expect(allOps[0].created_at.getTime()).toBe(inserted.created_at.getTime());
  });
});

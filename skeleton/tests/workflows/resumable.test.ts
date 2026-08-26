import { OperationStatus, successfulAssetCreation } from "../../src/models";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import {
  createServiceProxy,
  migrateIfNeeded,
  resumableWorkflow,
  WorkflowStorage,
} from "../../src/workflows";
// Internal — not re-exported from the workflows barrel.
import { setCurrentOperation } from "../../src/workflows/internal";
import { Pool } from "pg";

const finalSuccess = (assetId: string): OperationStatus =>
  successfulAssetCreation({ ledgerIdentifier: assetId, reference: undefined } as any);

async function waitForStatus(
  storage: WorkflowStorage,
  cid: string,
  targetStatus: "succeeded" | "failed",
  timeoutMs = 10_000,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const op = await storage.getOperationByCid(cid);
    if (op && op.status === targetStatus) return op;
    await setTimeoutPromise(100);
  }
  throw new Error(`Operation ${cid} did not reach '${targetStatus}' within ${timeoutMs}ms`);
}

async function waitForIntermediateStates(
  storage: WorkflowStorage,
  cid: string,
  expectedLength: number,
  timeoutMs = 10_000,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const op = await storage.getOperationByCid(cid);
    if (op && op.intermediate_states.length >= expectedLength) return op;
    await setTimeoutPromise(100);
  }
  throw new Error(`Operation ${cid} did not reach ${expectedLength} intermediate state(s) within ${timeoutMs}ms`);
}

describe("Resumable workflows", () => {
  let container: {
    connectionString: string;
    storageUser: string;
    cleanup: () => Promise<void>;
  } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() };
  let storage: WorkflowStorage;
  let pool: Pool;

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations",
      storageUser: container.storageUser,
      schemaName: "ledger_adapter",
    });
    pool = new Pool({ connectionString: container.connectionString });
    storage = new WorkflowStorage(pool, "ledger_adapter");
  });

  afterEach(async () => {
    setCurrentOperation(undefined);
    await pool.end();
    await container.cleanup();
  });

  // --- End-to-end, written exactly as a consumer would write the method body ---

  test("runs every stage once and records a checkpoint per string-returning stage", async () => {
    const calls = { start: 0, then0: 0, then1: 0 };

    // This object is the consumer's service implementation.
    const service = {
      async createAsset(_idempotencyKey: string, _assetId: string): Promise<OperationStatus> {
        return resumableWorkflow<OperationStatus>(
          {
            start: async () => {
              calls.start++;
              return "tx-deploy-hash"; // string -> checkpoint
            },
          },
          {
            then: async (txHash) => {
              calls.then0++;
              return JSON.stringify({ contractAddress: "erc20-addr", txHash }); // string -> checkpoint
            },
          },
          {
            then: async (strState) => {
              calls.then1++;
              const { contractAddress } = JSON.parse(strState);
              return finalSuccess(contractAddress); // object -> final result
            },
          },
        );
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    const proxy = createServiceProxy(() => Promise.resolve(), storage, undefined, service, "createAsset");

    const pending = await proxy.createAsset("idem-happy", "asset-happy");
    const cid = (pending as any).correlationId;

    const op = await waitForStatus(storage, cid, "succeeded");

    expect(calls).toEqual({ start: 1, then0: 1, then1: 1 });
    expect(op.intermediate_states).toEqual([
      "tx-deploy-hash",
      JSON.stringify({ contractAddress: "erc20-addr", txHash: "tx-deploy-hash" }),
    ]);
    expect(op.outputs.type).toBe("success");
    expect(op.outputs.result.ledgerIdentifier).toBe("erc20-addr");
  });

  test("on restart, skips completed stages and resumes from the last checkpoint", async () => {
    // --- attempt 1: start checkpoints, then the next stage hangs (== crash) ---
    const v1 = {
      async createAsset(_idempotencyKey: string, _assetId: string): Promise<OperationStatus> {
        return resumableWorkflow<OperationStatus>(
          { start: async () => "tx-deploy-hash" },
          { then: async () => new Promise<OperationStatus>(() => {}) }, // never resolves
        );
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    const proxy1 = createServiceProxy(() => Promise.resolve(), storage, undefined, v1, "createAsset");
    const pending = await proxy1.createAsset("idem-resume", "asset-resume");
    const cid = (pending as any).correlationId;

    // start ran and checkpointed; the second stage is stuck -> still in_progress
    const midway = await waitForIntermediateStates(storage, cid, 1);
    expect(midway.intermediate_states).toEqual(["tx-deploy-hash"]);
    expect(midway.status).toBe("in_progress");

    // --- "CRASH": abandon proxy1, bring up proxy2 with a service that completes ---
    const v2Calls = { start: 0, then0: 0 };
    let then0Input: string | undefined;
    const v2 = {
      async createAsset(_idempotencyKey: string, _assetId: string): Promise<OperationStatus> {
        return resumableWorkflow<OperationStatus>(
          {
            start: async () => {
              v2Calls.start++; // must NOT happen — start already completed before the crash
              return "tx-deploy-hash";
            },
          },
          {
            then: async (txHash) => {
              v2Calls.then0++;
              then0Input = txHash;
              return finalSuccess("erc20-addr"); // object -> final result
            },
          },
        );
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    // createServiceProxy replays in_progress operations on construction.
    createServiceProxy(() => Promise.resolve(), storage, undefined, v2, "createAsset");

    const op = await waitForStatus(storage, cid, "succeeded");

    expect(v2Calls.start).toBe(0); // resumed: start skipped
    expect(v2Calls.then0).toBe(1); // resumed: continuation ran
    expect(then0Input).toBe("tx-deploy-hash"); // fed the persisted checkpoint
    expect(op.intermediate_states).toEqual(["tx-deploy-hash"]); // final stage returned object -> no new checkpoint
    expect(op.outputs.type).toBe("success");
  });

  // --- Lower-level checks of the resume arithmetic and error contract ---

  test("with two existing checkpoints, start and the first `then` are skipped", async () => {
    await storage.saveOperation({
      cid: "seed-2", method: "createAsset", status: "in_progress",
      inputs: ["two-checkpoints"], outputs: {},
    });
    await storage.appendIntermediateState("seed-2", "s0");
    await storage.appendIntermediateState("seed-2", "s1");

    const calls = { start: 0, then0: 0, then1: 0 };
    let then1Input: string | undefined;

    setCurrentOperation({ cid: "seed-2", storage });
    const result = await resumableWorkflow<OperationStatus>(
      { start: async () => { calls.start++; return "s0"; } },
      { then: async () => { calls.then0++; return "s1"; } },
      { then: async (prev) => { calls.then1++; then1Input = prev; return finalSuccess("done"); } },
    );

    expect(calls).toEqual({ start: 0, then0: 0, then1: 1 });
    expect(then1Input).toBe("s1");
    expect((result as any).type).toBe("success");
  });

  test("a stage returning a non-string finishes immediately with no checkpoint", async () => {
    await storage.saveOperation({
      cid: "seed-final", method: "createAsset", status: "in_progress",
      inputs: ["immediate-final"], outputs: {},
    });

    setCurrentOperation({ cid: "seed-final", storage });
    const result = await resumableWorkflow<OperationStatus>(
      { start: async () => finalSuccess("instant") },
      { then: async () => finalSuccess("unused") },
    );

    expect((result as any).type).toBe("success");
    const op = await storage.getOperationByCid("seed-final");
    expect(op!.intermediate_states).toEqual([]);
  });

  test("errors when a checkpoint is produced but no continuation stage is provided", async () => {
    await storage.saveOperation({
      cid: "seed-err", method: "createAsset", status: "in_progress",
      inputs: ["no-continuation"], outputs: {},
    });

    setCurrentOperation({ cid: "seed-err", storage });
    await expect(
      resumableWorkflow<OperationStatus>({
        start: async () => "checkpoint-with-nowhere-to-go",
      }),
    ).rejects.toThrow(/produced an intermediate state but only 0/);

    // the checkpoint was still persisted before the workflow gave up
    const op = await storage.getOperationByCid("seed-err");
    expect(op!.intermediate_states).toEqual(["checkpoint-with-nowhere-to-go"]);
  });

  test("errors when called outside of an operation", async () => {
    setCurrentOperation(undefined);
    await expect(
      resumableWorkflow<OperationStatus>({ start: async () => "x" }),
    ).rejects.toThrow(/no current operation/);
  });

  test("errors when the current cid has no operation row", async () => {
    setCurrentOperation({ cid: "no-such-cid", storage });
    await expect(
      resumableWorkflow<OperationStatus>({ start: async () => "x" }),
    ).rejects.toThrow(/no operation row found/);
  });

  test("context does not leak across concurrent operations", async () => {
    const service = {
      async createAsset(_idempotencyKey: string, assetId: string): Promise<OperationStatus> {
        return resumableWorkflow<OperationStatus>(
          {
            start: async () => {
              await setTimeoutPromise(50); // interleave the two calls
              return `checkpoint-${assetId}`; // lands on the ambient operation's row
            },
          },
          { then: async () => finalSuccess(assetId) },
        );
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    const proxy = createServiceProxy(() => Promise.resolve(), storage, undefined, service, "createAsset");
    const [p1, p2] = await Promise.all([
      proxy.createAsset("idem-a", "asset-a"),
      proxy.createAsset("idem-b", "asset-b"),
    ]);
    const cid1 = (p1 as any).correlationId;
    const cid2 = (p2 as any).correlationId;

    const op1 = await waitForStatus(storage, cid1, "succeeded");
    const op2 = await waitForStatus(storage, cid2, "succeeded");

    // a leaked context would checkpoint onto the other operation's row
    expect(op1.intermediate_states).toEqual(["checkpoint-asset-a"]);
    expect(op2.intermediate_states).toEqual(["checkpoint-asset-b"]);
  });

  test("the startup-replay SELECT completes before any live operation is inserted", async () => {
    // If a live row can be inserted while the replay SELECT is still in flight,
    // the SELECT picks it up and the operation executes twice. The invariant is
    // ordering: replay SELECT done -> only then live inserts. Record both events
    // with the SELECT slowed by 100ms (on a fast machine the buggy code would
    // otherwise still win the race by luck).
    const events: string[] = [];
    const instrumented: WorkflowStorage = new Proxy(storage, {
      get(target: any, prop) {
        if (prop === "getPendingOperations") {
          return async (method: string) => {
            await setTimeoutPromise(100);
            const ops = await target.getPendingOperations(method);
            events.push("replay-select-done");
            return ops;
          };
        }
        if (prop === "saveOperation") {
          return (op: any) => {
            events.push("live-insert");
            return target.saveOperation(op);
          };
        }
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });

    const service = {
      async createAsset(_idempotencyKey: string, _assetId: string): Promise<OperationStatus> {
        return finalSuccess("asset-race");
      },
      async operationStatus(_cid: string): Promise<any> {},
    };

    const proxy = createServiceProxy(() => Promise.resolve(), instrumented, undefined, service, "createAsset");
    await proxy.createAsset("idem-race", "asset-race");

    expect(events).toEqual(["replay-select-done", "live-insert"]);
  });
});

import {
  approvedPlan,
  OperationStatus,
  pendingAssetCreation,
  pendingDepositOperation,
  pendingPlan,
  rejectedPlan,
  successfulAssetCreation,
} from "@owneraio/finp2p-adapter-models";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import {
  createServiceProxy,
  migrateIfNeeded,
  Storage,
} from "../../src/workflows";

async function waitForOperationCompletion<T extends { operationStatus(cid: string): Promise<any> }>(obj: T, cid: string): Promise<any> {
  for (let i = 0; i < 30; i++) {
    const result = await obj.operationStatus(cid) as { correlationId?: string }
    console.debug({
      attempt: i,
      result
    })
    if (result.correlationId === undefined) {
      return result
    }

    await setTimeoutPromise(300)
  }

  throw new Error('Operation not finished')
}

describe("Service operation tests", () => {
  let container: { connectionString: string; storageUser: string, cleanup: () => Promise<void> } = {
    connectionString: "",
    storageUser: "",
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
      storageUser: container.storageUser
    });
    const s = new Storage(container);
    storage = () => s;
  });
  afterEach(async () => {
    await storage().closeConnections();
    await container.cleanup();
  });

  test("proxy intercepts only provided methods", async () => {
    class Service {
      async approvePlan(
        idempotencyKey: string,
        planId: string,
      ): Promise<OperationStatus> {
        return setTimeoutPromise(5_000, approvedPlan());
      }

      async createAsset(
        idempotencyKey: string,
        assetId: string,
      ): Promise<OperationStatus> {
        return setTimeoutPromise(
          5_000,
          successfulAssetCreation({
            reference: {
              additionalContractDetails: {
                allowanceRequired: false,
                finP2POperatorContractAddress: "",
              },
              address: "123",
              network: "local5",
              tokenStandard: "ERC20",
              type: "ledgerReference",
            },
            tokenId: "123",
          }),
        );
      }

      async deposit(
        idempotencyKey: string,
        value: string,
      ): Promise<OperationStatus> {
        throw new Error("Couldn'nt connect to RPC");
      }

      async operationStatus(cid: string): Promise<any> {
        console.debug('Original called')
      }
    }

    const impl = new Service();
    const proxied = createServiceProxy(
      () => Promise.resolve(),
      storage(),
      undefined,
      impl,
      {
        name: "approvePlan",
        pendingState: cid => pendingPlan(cid, undefined)
      },
      {
        name: "deposit",
        pendingState: cid => pendingDepositOperation(cid, undefined)
      },
    );

    await expect(storage().operationsAll()).resolves.toEqual([]);
    const result = await proxied.approvePlan("idempotency-key-1", "plan1");
    await expect(storage().operationsAll()).resolves.not.toEqual([]);
    let operation = (await storage().operationsAll())[0];
    expect(operation.inputs).toEqual(["idempotency-key-1", "plan1"]);
    expect(result).toEqual(pendingPlan(operation.cid, undefined));
    await expect(waitForOperationCompletion(proxied, operation.cid)).resolves.toEqual(approvedPlan())

    const result2 = await proxied.createAsset("idempotency-key-2", "asset-id");
    expect((await storage().operationsAll()).length).toBe(1);

    const crash = await proxied.deposit("idempotency-key-3", "155.322");
    expect((await storage().operationsAll()).length).toBe(2);
    operation = (await storage().operationsAll())[1];

    await expect(waitForOperationCompletion(proxied, operation.cid)).resolves.toEqual(expect.anything())
    operation = (await storage().operationsAll())[1];
    expect(operation.status).toEqual("failed");
    expect(operation.outputs).toMatch("connect to RPC");
  });

  test("calling the same inputs will result cached response", async () => {
    class Service {
      callCount = new Map<string, number>();

      async approve(
        idempotencyKey: string,
        planId: string,
      ): Promise<OperationStatus> {
        const pseudoKey = JSON.stringify([idempotencyKey, planId]);
        const value = this.callCount.get(pseudoKey) ?? 0;
        this.callCount.set(pseudoKey, value + 1);
        return approvedPlan();
      }
    }

    const service = new Service();
    const proxied = createServiceProxy(() => Promise.resolve(), storage(), undefined, service, {
      name: "approve",
      pendingState: cid => pendingPlan(cid, undefined)
    });

    const idempotencyKey = Math.random().toString(36);
    const planId = Math.random().toString();
    expect(
      service.callCount.get(JSON.stringify([idempotencyKey, planId])),
    ).toBeUndefined();
    await expect(
      proxied.approve(idempotencyKey, planId),
    ).resolves.toBeDefined();
    expect(
      service.callCount.get(JSON.stringify([idempotencyKey, planId])),
    ).toBe(1);

    // Duplicating the request
    await expect(
      proxied.approve(idempotencyKey, planId),
    ).resolves.toBeDefined();
    expect(
      service.callCount.get(JSON.stringify([idempotencyKey, planId])),
    ).toBe(1);

    const otherIdempotencyKey = Math.random().toString(36);
    expect(
      service.callCount.get(JSON.stringify([otherIdempotencyKey, planId])),
    ).toBeUndefined();
    await expect(
      proxied.approve(otherIdempotencyKey, planId),
    ).resolves.toBeDefined();
    expect(
      service.callCount.get(JSON.stringify([otherIdempotencyKey, planId])),
    ).toBe(1);

    // Duplicating the earlier request
    await expect(
      proxied.approve(idempotencyKey, planId),
    ).resolves.toBeDefined();
    expect(
      service.callCount.get(JSON.stringify([idempotencyKey, planId])),
    ).toBe(1);

    expect(service.callCount.size).toBe(2);
  });

  test("interrupted methods should be restarted", async () => {
    class Service {
      async createAsset(
        idempotencyKey: string,
        decimals: number,
        amount: string,
      ): Promise<OperationStatus> {
        return successfulAssetCreation({
          tokenId: idempotencyKey,
          reference: {
            type: "ledgerReference",
            tokenStandard: "createAsset",
            network: decimals.toString(),
            address: amount,
            additionalContractDetails: {
              allowanceRequired: false,
              finP2POperatorContractAddress: "0x000",
            },
          },
        });
      }

      async rejectPlan(
        idempotencyKey: string,
        planId: string,
      ): Promise<OperationStatus> {
        if (idempotencyKey === "crash-idempotency-key-2")
          throw new Error("OSS failed to return proper data");

        return rejectedPlan(404, [idempotencyKey, planId].join(":"));
      }
    }

    const [row1, inserted1] = await storage().insert({
      cid: "old-cid",
      inputs: ["fake-idempotency-key-1", 5, "655000"],
      method: "createAsset",
      outputs: {},
      status: "in_progress",
    });
    expect(inserted1).toBe(true);

    const [row2, inserted2] = await storage().insert({
      cid: "new-cid",
      inputs: ["should-fail-idempotency", "plan-id-0"],
      method: "rejectPlan",
      outputs: {},
      status: "in_progress",
    });
    expect(inserted2).toBe(true);

    const [row3, inserted3] = await storage().insert({
      cid: "newer-cid",
      inputs: ["crash-idempotency-key-2", "plan-id-0"],
      method: "rejectPlan",
      outputs: {},
      status: "in_progress",
    });
    expect(inserted3).toBe(true);

    const service = new Service();
    const proxied = createServiceProxy(
      () => Promise.resolve(),
      storage(),
      undefined,
      service,
      { name: "createAsset", pendingState: cid => pendingAssetCreation(cid, undefined) },
      { name: "rejectPlan", pendingState: cid => pendingPlan(cid, undefined) },
    );
    await setTimeoutPromise(5000);

    await expect(storage().operation(row1.cid)).resolves.toEqual({
      ...row1,
      outputs: successfulAssetCreation({
        tokenId: "fake-idempotency-key-1",
        reference: {
          type: "ledgerReference",
          tokenStandard: "createAsset",
          network: (5).toString(),
          address: "655000",
          additionalContractDetails: {
            allowanceRequired: false,
            finP2POperatorContractAddress: "0x000",
          },
        },
      }),
      status: "succeeded",
      updated_at: expect.any(Date),
    });

    await expect(storage().operation(row2.cid)).resolves.toEqual({
      ...row2,
      updated_at: expect.any(Date),
      outputs: rejectedPlan(404, "should-fail-idempotency:plan-id-0"),
      status: "failed",
    });

    await expect(storage().operation(row3.cid)).resolves.toEqual({
      ...row3,
      updated_at: expect.any(Date),
      outputs: expect.stringContaining("OSS failed to return proper data"),
      status: "failed",
    });
  });
});

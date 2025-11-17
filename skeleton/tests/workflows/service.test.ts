import {
  approvedPlan,
  OperationStatus,
  successfulAssetCreation,
} from "@owneraio/finp2p-adapter-models";
import {
  createServiceProxy,
  migrateIfNeeded,
  Storage,
} from "../../src/workflows";
import { expectDateToBeClose } from "../expectDateToBeClose";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";

describe("Service operation tests", () => {
  let container: { connectionString: string; cleanup: () => Promise<void> } = {
    connectionString: "",
    cleanup: () => Promise.resolve(),
  };
  let storage = (): Storage => { throw new Error('Not initialized yet') };
  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations",
    });
    const s = new Storage(container)
    storage = () => s
  });
  afterEach(async () => {
    await storage().closeConnections()
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
    }

    const impl = new Service();
    const proxied = createServiceProxy(
      storage(),
      undefined,
      impl,
      {
        name: "approvePlan",
        operation: "approval",
      },
      {
        name: "deposit",
        operation: "deposit",
      },
    );

    await expect(storage().operationsAll()).resolves.toEqual([]);
    const result = await proxied.approvePlan("idempotency-key-1", "plan1");
    await expect(storage().operationsAll()).resolves.not.toEqual([]);
    let operation = (await storage().operationsAll())[0];
    expect(operation.inputs).toEqual(["idempotency-key-1", "plan1"]);
    expect(result).toEqual(approvedPlan()); // TODO: check for callbacks

    const result2 = await proxied.createAsset("idempotency-key-2", "asset-id");
    expect((await storage().operationsAll()).length).toBe(1);

    const crash = await proxied.deposit("idempotency-key-3", "155.322");
    expect((await storage().operationsAll()).length).toBe(2);
    operation = (await storage().operationsAll())[1];

    expect(operation.status).toEqual("failed");
    expect(operation.outputs).toMatch("connect to RPC");
  });

  test('calling the same inputs will result cached response', async () => {
    class Service {
      callCount = new Map<string, number>()

      async approve(idempotencyKey: string, planId: string): Promise<OperationStatus> {
        const pseudoKey = JSON.stringify([idempotencyKey, planId])
        const value = this.callCount.get(pseudoKey) ?? 0
        this.callCount.set(pseudoKey, value + 1)
        return approvedPlan()
      }
    }

    const service = new Service()
    const proxied = createServiceProxy(storage(), undefined, service, {
      name: 'approve', operation: 'approval' })

    const idempotencyKey = Math.random().toString(36)
    const planId = Math.random().toString()
    expect(service.callCount.get(JSON.stringify([idempotencyKey, planId]))).toBeUndefined()
    await expect(proxied.approve(idempotencyKey, planId)).resolves.toBeDefined()
    expect(service.callCount.get(JSON.stringify([idempotencyKey, planId]))).toBe(1)

    // Duplicating the request
    await expect(proxied.approve(idempotencyKey, planId)).resolves.toBeDefined()
    expect(service.callCount.get(JSON.stringify([idempotencyKey, planId]))).toBe(1)

    const otherIdempotencyKey = Math.random().toString(36)
    expect(service.callCount.get(JSON.stringify([otherIdempotencyKey, planId]))).toBeUndefined()
    await expect(proxied.approve(otherIdempotencyKey, planId)).resolves.toBeDefined()
    expect(service.callCount.get(JSON.stringify([otherIdempotencyKey, planId]))).toBe(1)

    // Duplicating the earlier request
    await expect(proxied.approve(idempotencyKey, planId)).resolves.toBeDefined()
    expect(service.callCount.get(JSON.stringify([idempotencyKey, planId]))).toBe(1)

    expect(service.callCount.size).toBe(2)
  })
});

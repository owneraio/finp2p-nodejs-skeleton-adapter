import {
  approvedPlan,
  OperationStatus,
  successfulAssetCreation,
} from "@owneraio/finp2p-adapter-models";
import {
  createServiceProxy,
  migrateIfNeeded,
  WorkflowStorage,
} from "../../src";
import { expectDateToBeClose } from "../expectDateToBeClose";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";

describe("Service operation tests", () => {
  let container: { connectionString: string; cleanup: () => Promise<void> } = {
    connectionString: "",
    cleanup: () => Promise.resolve(),
  };
  let storage = (): WorkflowStorage => { throw new Error('Not initialized yet') };
  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations",
    });
    const s = new WorkflowStorage(container)
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
});

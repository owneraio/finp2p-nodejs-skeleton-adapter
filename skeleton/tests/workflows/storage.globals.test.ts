import { migrateIfNeeded, WorkflowStorage } from '../../src/workflows'
import { PgAssetStore } from '../../src/storage'
import { Pool } from 'pg'

describe("storage instance methods", () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let workflowStorage: WorkflowStorage;
  let pool: Pool;
  let assetStore: PgAssetStore;

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
    pool = new Pool({ connectionString: container.connectionString });
    workflowStorage = new WorkflowStorage(pool)
    assetStore = new PgAssetStore(pool);
  })
  afterEach(async () => {
    await pool.end();
    await container.cleanup();
  });

  test("inserting and querying assets via asset store", async () => {
    const asset = { type: "cryptocurrency", id: "usdc" }
    await expect(assetStore.getAsset(asset)).resolves.toBeUndefined()

    const savedAsset = await assetStore.saveAsset({ ...asset, contract_address: "", decimals: 6, token_standard: 'ERC20' })
    await expect(assetStore.getAsset(asset)).resolves.toEqual(savedAsset)
  })

  test("querying special receipt objects via workflow storage", async () => {
    await expect(workflowStorage.getOperationByReceiptId("do not exists")).resolves.toBeUndefined()

    await workflowStorage.saveOperation({ cid: "random", inputs: [ "idempotencyKey", "arg1" ], method: "deposit", status: 'succeeded', outputs: { receipt: { id: "do not exists" } } })
    await expect(workflowStorage.getOperationByReceiptId("do not exists")).resolves.toBeDefined()
  })
})

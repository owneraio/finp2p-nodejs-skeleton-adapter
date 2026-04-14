import { migrateIfNeeded, Storage } from '../../src/workflows'
import { SharedStorage } from '../../src/storage'

describe("storage instance methods", () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let storage: Storage;
  let shared: SharedStorage;

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
    storage = new Storage(container)
    shared = new SharedStorage(container)
  })
  afterEach(async () => {
    await storage.closeConnections();
    await shared.close();
    await container.cleanup();
  });

  test("inserting and querying assets via shared storage", async () => {
    const asset = { type: "cryptocurrency", id: "usdc" }
    await expect(shared.assets.getAsset(asset)).resolves.toBeUndefined()

    const savedAsset = await shared.assets.saveAsset({ ...asset, contract_address: "", decimals: 6, token_standard: 'ERC20' })
    await expect(shared.assets.getAsset(asset)).resolves.toEqual(savedAsset)
  })

  test("querying special receipt objects via workflow storage", async () => {
    await expect(storage.getReceiptOperation("do not exists")).resolves.toBeUndefined()

    await storage.insert({ cid: "random", inputs: [ "idempotencyKey", "arg1" ], method: "deposit", status: 'succeeded', outputs: { receipt: { id: "do not exists" } } })
    await expect(storage.getReceiptOperation("do not exists")).resolves.toBeDefined()
  })
})

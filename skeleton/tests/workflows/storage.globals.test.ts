import { migrateIfNeeded, Storage } from '../../src/workflows'

describe("storage instance methods", () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let storage: Storage;

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
  })
  afterEach(async () => {
    await storage.closeConnections();
    await container.cleanup();
  });

  test("inserting and querying assets", async () => {
    const asset = { type: "cryptocurrency", id: "usdc" }
    await expect(storage.getAsset(asset)).resolves.toBeUndefined()

    const savedAsset = await storage.saveAsset({ ...asset, contract_address: "", decimals: 6, token_standard: 'ERC20' })
    await expect(storage.getAsset(asset)).resolves.toEqual(savedAsset)
  })

  test("querying special receipt objects", async () => {
    await expect(storage.getReceiptOperation("do not exists")).resolves.toBeUndefined()

    await storage.insert({ cid: "random", inputs: [ "idempotencyKey", "arg1" ], method: "deposit", status: 'succeeded', outputs: { receipt: { id: "do not exists" } } })
    await expect(storage.getReceiptOperation("do not exists")).resolves.toBeDefined()
  })
})

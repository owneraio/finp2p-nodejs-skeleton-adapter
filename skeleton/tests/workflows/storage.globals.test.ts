import * as workflows from '../../src/workflows'

describe("global storage methods", () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let storage = (): workflows.Storage => { throw new Error('Not initialized yet') }
  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await workflows.migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations",
      storageUser: container.storageUser
    })
    const s = new workflows.Storage(container)
    storage = () => s
  })
  afterEach(async () => {
    await storage().closeConnections();
    await container.cleanup();
  });

  test("inserting and querying assets", async () => {
    const asset = { type: "cryptocurrency", id: "usdc" }
    await expect(workflows.getAsset(asset)).resolves.toBeUndefined()

    const savedAsset = await workflows.saveAsset({ ...asset, contractAddress: "", decimals: 6, tokenStandard: 'ERC20' })
    expect(savedAsset).toMatchObject({ ...asset, contractAddress: "", decimals: 6, tokenStandard: 'ERC20' })
    expect(savedAsset.createdAt).toBeInstanceOf(Date)
    expect(savedAsset.updatedAt).toBeInstanceOf(Date)

    await expect(workflows.getAsset(asset)).resolves.toEqual(savedAsset)
  })

  test("saving duplicate asset returns existing one", async () => {
    const asset = { type: "cryptocurrency", id: "usdc", contractAddress: "0x123", decimals: 6, tokenStandard: 'ERC20' as const }
    const first = await workflows.saveAsset(asset)
    const second = await workflows.saveAsset(asset)

    expect(second).toEqual(first)
  })

  test("querying special receipt objects", async () => {
    await expect(workflows.getReceiptOperation("do not exists")).resolves.toBeUndefined()

    await storage().insert({ cid: "random", inputs: [ "idempotencyKey", "arg1" ], method: "deposit", status: 'succeeded', outputs: { receipt: { id: "do not exists" } } })
    await expect(workflows.getReceiptOperation("do not exists")).resolves.toBeDefined()
  })
})

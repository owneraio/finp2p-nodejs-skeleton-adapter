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
    await expect(workflows.getAsset("asset_id")).resolves.toBeUndefined()

    const savedAsset = await workflows.saveAsset({ asset_id: "asset_id", contract_address: "", contract_abi: null, decimals: 6 })
    await expect(workflows.getAsset("asset_id")).resolves.toEqual(savedAsset)
  })
})

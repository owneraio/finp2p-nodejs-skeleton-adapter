import { migrateIfNeeded, WorkflowStorage } from '../../src/workflows'
import { Pool } from 'pg'

describe("storage instance methods", () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let workflowStorage: WorkflowStorage;
  let pool: Pool;

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
  })
  afterEach(async () => {
    await pool.end();
    await container.cleanup();
  });

  test("querying special receipt objects via workflow storage", async () => {
    await expect(workflowStorage.getOperationByReceiptId("do not exists")).resolves.toBeUndefined()

    await workflowStorage.saveOperation({ cid: "random", inputs: [ "idempotencyKey", "arg1" ], method: "deposit", status: 'succeeded', outputs: { receipt: { id: "do not exists" } } })
    await expect(workflowStorage.getOperationByReceiptId("do not exists")).resolves.toBeDefined()
  })
})

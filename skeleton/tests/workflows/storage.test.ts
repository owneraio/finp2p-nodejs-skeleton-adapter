import { migrateIfNeeded, WorkflowStorage } from '../../src'

describe('Storage operations', () => {
  let container: { connectionString: string, cleanup: () => Promise<void> } = { connectionString: "", cleanup: () => Promise.resolve() }
  let storage = () => new WorkflowStorage(container)
  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer()
    return migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations"
    })
  })
  afterEach(() => container.cleanup())

  test('check autopopulation of optional fields', async () => {
    const ix = {
      inputs: { value: 32 },
      outputs: { signature: { tx: "hash" } },
      method: "nonExistent",
      status: 'unknown' as const,
      idempotency_key: 'ownera'
    }

    const row = await storage().insert(ix)
    expect(row.cid).toEqual(expect.any(String))
    expect(row.status).toEqual(ix.status)
    expect(row.idempotency_key).toEqual(ix.idempotency_key)
  })

  test('other check', () => {
  })
})

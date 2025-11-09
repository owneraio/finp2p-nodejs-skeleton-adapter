import { migrateIfNeeded, WorkflowStorage } from '../../src'
import { expectDateToBeClose } from '../expectDateToBeClose'

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
    const creationDate = new Date()

    const row = await storage().insert(ix)
    expect(row.cid).toEqual(expect.any(String))
    expect(row.status).toEqual(ix.status)
    expect(row.inputs).toEqual({ value: 32 })
    expect(row.outputs).toEqual({ signature: { tx: 'hash' } })
    expect(row.idempotency_key).toEqual(ix.idempotency_key)
    expectDateToBeClose(row.created_at, creationDate)
    expectDateToBeClose(row.updated_at, creationDate)
  })

  test('providing optional fields may be reset', async () => {
    const ix = {
      inputs: { value: 32 },
      outputs: { signature: { tx: "hash" } },
      method: "nonExistent",
      status: 'unknown' as const,
      idempotency_key: 'ownera',
      cid: 'should be overriden',
      created_at: new Date(2000, 1, 2, 3, 4, 5),
      updated_at: new Date(1990, 1, 2, 3, 4, 5),
    }
    const creationDate = new Date()

    const row = await storage().insert(ix)
    expect(row.cid).toEqual(expect.any(String))
    expect(row.cid).not.toEqual('should be overriden')
    expect(row.status).toEqual(ix.status)
    expect(row.idempotency_key).toEqual(ix.idempotency_key)
    expectDateToBeClose(row.created_at, creationDate)
    expectDateToBeClose(row.updated_at, creationDate)
  })

  test('updating row should autopopulate updated_at field but not created_at', async () => {
    const ix = {
      inputs: { value: 32 },
      outputs: { signature: { tx: "hash" } },
      method: "nonExistent",
      status: 'unknown' as const,
      idempotency_key: 'ownera'
    }
    const creationDate = new Date()

    const row = await storage().insert(ix)
    await new Promise(resolve => setTimeout(resolve, 20_000))

    const updateDate = new Date()
    const urow = await storage().update(row.cid, "failed", { assetBalance: { name: 'USDC', value: 12345 } })

    expectDateToBeClose(row.created_at, urow.created_at)
    expectDateToBeClose(urow.updated_at, updateDate)
    expect(urow.status).toEqual('failed')
    expect(urow.outputs).toEqual({ assetBalance: { name: 'USDC', value: 12345 } })

    const grow = await storage().operation(row.cid)
    expectDateToBeClose(row.created_at, urow.created_at)
    expectDateToBeClose(urow.updated_at, updateDate)
    expect(urow.status).toEqual('failed')
    expect(urow.outputs).toEqual({ assetBalance: { name: 'USDC', value: 12345 } })
  })
})

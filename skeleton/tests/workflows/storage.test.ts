import { migrateIfNeeded } from '../../src'

describe('Storage operations', () => {
  let container: { connectionString: string, cleanup: () => Promise<void> } = { connectionString: "", cleanup: () => Promise.resolve() }
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

  test('check', () => {
    console.log('check')
  })

  test('other check', () => {
    console.log('other check')
  })
})

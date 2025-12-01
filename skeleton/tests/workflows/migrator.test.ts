import * as migrator from '../../src/workflows/migrator'

describe('Postgres migrator should work properly', () => {
  test('Migrator runs without error when everything provided', async () => {
    // @ts-ignore
    const container = (await global.startPostgresContainer()) as { connectionString: string, storageUser: string, cleanup: () => Promise<void> }

    console.log('migrating', container.connectionString)
    await expect(
      migrator.migrateIfNeeded({
        connectionString: container.connectionString,
        // @ts-ignore
        gooseExecutablePath: await global.whichGoose(),
        migrationListTableName: "js_migration_tables",
        storageUser: container.storageUser
      })
    ).resolves.toBeUndefined()

    await container.cleanup()
  })
})

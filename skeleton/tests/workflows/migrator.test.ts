import * as migrator from '../../src/workflows/migrator'

describe('Postgres migrator should work properly', () => {
  test('Migrator runs without error when everything provided', async () => {
    await expect(
      migrator.migrateIfNeeded({
        // @ts-ignore
        connectionString: global.DB_CONNECTION_STRING,
        // @ts-ignore
        gooseExecutablePath: global.GOOSE_PATH,
        migrationListTableName: "js_migration_tables"
      })
    ).resolves.toBeUndefined()
  })
})

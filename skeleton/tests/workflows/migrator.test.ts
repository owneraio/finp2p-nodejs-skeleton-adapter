import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { Pool } from 'pg'
import * as migrator from '../../src/workflows/migrator'

const run = promisify(execFile)

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
        storageUser: container.storageUser,
        schemaName: "ledger_adapter",
      })
    ).resolves.toBeUndefined()

    await container.cleanup()
  })

  /**
   * `operation_steps` and `resource_claims` are created with
   * CREATE TABLE IF NOT EXISTS by this migration *and* by the migration of any
   * adapter embedding a plugin host, so neither side owns them. Rolling back
   * this migration must therefore not drop them: the other side's migration is
   * still applied, and a lost `done` step means a step that already ran runs
   * again after a restart — for an order placed with an external venue, that is
   * placing it twice.
   */
  test('rolling back the steps migration leaves the shared tables and their rows', async () => {
    // @ts-ignore
    const container = (await global.startPostgresContainer()) as { connectionString: string, storageUser: string, cleanup: () => Promise<void> }
    // @ts-ignore
    const goose = await global.whichGoose() as string
    const TABLE = 'js_migration_tables'
    const dir = path.join(__dirname, '..', '..', 'migrations')
    const env = {
      ...process.env,
      GOOSE_DBSTRING: container.connectionString,
      GOOSE_DRIVER: 'postgres',
      LEDGER_ADAPTER_USER: container.storageUser,
      LEDGER_SCHEMA: 'ledger_adapter',
    }
    const pool = new Pool({ connectionString: container.connectionString })
    const stepCount = async () => {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM ledger_adapter.operation_steps WHERE operation_id = 'survives'`)
      return rows[0].n as number
    }

    try {
      await migrator.migrateIfNeeded({
        connectionString: container.connectionString,
        gooseExecutablePath: goose,
        migrationListTableName: TABLE,
        storageUser: container.storageUser,
        schemaName: 'ledger_adapter',
      })

      await pool.query(
        `INSERT INTO ledger_adapter.operation_steps
           (scope, method, operation_id, step_name, request_hash, state, attempt,
            first_started_at, attempt_started_at, output)
         VALUES ('wisdomtree', 'issue', 'survives', 'place-order', repeat('a', 64),
                 'done', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{"orderReference":"ord-1"}')`)
      await pool.query(
        `INSERT INTO ledger_adapter.resource_claims (scope, namespace, resource, operation_id)
         VALUES ('wisdomtree', 'burn', 'burn-1', 'survives')`)
      expect(await stepCount()).toBe(1)

      // Roll this migration back. It is the newest, so `down` is exactly it.
      await run(goose, ['-table', TABLE, '-dir', dir, 'down'], { env })

      // Both tables, and the stored outcome, must still be there.
      expect(await stepCount()).toBe(1)
      const { rows: claims } = await pool.query(
        `SELECT operation_id FROM ledger_adapter.resource_claims WHERE resource = 'burn-1'`)
      expect(claims[0].operation_id).toBe('survives')

      // And re-applying it is a no-op over the existing tables.
      await run(goose, ['-table', TABLE, '-dir', dir, 'up'], { env })
      expect(await stepCount()).toBe(1)
    } finally {
      await pool.end()
      await container.cleanup()
    }
  }, 60_000)
})

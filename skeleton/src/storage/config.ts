export interface AdditionalMigration {
  /** Directory containing goose migration SQL files */
  migrationsDir: string;
  /** Goose table name for tracking these migrations */
  tableName: string;
}

export interface MigrationConfig {
  gooseExecutablePath: string;
  migrationListTableName: string;
  connectionString: string;
  /**
   * User to grant select/update/delete/insert operations for the tables.
   * Usually user of the storage config connection string.
   */
  storageUser: string;
  /**
   * PostgreSQL schema name where skeleton tables (operations, assets,
   * account_mappings, …) are created. Adapters that share a database should
   * pass an adapter-specific name (e.g. 'sepolia', 'heder') so they don't
   * collide on a global schema. Defaults to 'ledger_adapter' for backward
   * compatibility. Operators can override the adapter's default at deploy
   * time via the LEDGER_SCHEMA env var.
   */
  schemaName?: string;
  /** Additional migration sets to run after skeleton migrations (e.g. vanilla-service) */
  additionalMigrations?: AdditionalMigration[];
}

/** Default schema name when neither adapter config nor env var override it. */
export const DEFAULT_SCHEMA_NAME = 'ledger_adapter';

/**
 * Validates a Postgres schema identifier — the schema name is interpolated
 * directly into SQL strings (Postgres parameterized queries can't bind
 * identifiers), so we lock it down to safe characters at construction time.
 */
export function assertValidSchemaName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid schema name: ${JSON.stringify(name)}. Must match /^[A-Za-z_][A-Za-z0-9_]*$/.`);
  }
}

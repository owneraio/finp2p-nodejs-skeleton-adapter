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
   * account_mappings, …) are created. Adapters that share a database must
   * pass an adapter-specific name (e.g. 'sepolia', 'heder') so they don't
   * collide on a global schema. Operators can override the adapter's choice
   * at deploy time via the LEDGER_SCHEMA env var.
   */
  schemaName: string;
  /** Additional migration sets to run after skeleton migrations (e.g. vanilla-service) */
  additionalMigrations?: AdditionalMigration[];
}

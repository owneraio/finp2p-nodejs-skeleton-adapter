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
  /** Additional migration sets to run after skeleton migrations (e.g. vanilla-service) */
  additionalMigrations?: AdditionalMigration[];
}

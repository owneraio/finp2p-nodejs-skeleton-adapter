export interface MigrationConfig {
  gooseExecutablePath: string
  migrationListTableName: string
  connectionString: string
  /**
   * User to for grant select/update/delete/insert operations for the tables.
   * Usually user of the storage config connection string
   */
  storageUser: string
}

export interface StorageConfig {
  connectionString: string
}

export interface Config {
  migration: MigrationConfig
  storage: StorageConfig
}

export interface MigrationConfig {
  gooseExecutablePath: string
  migrationListTableName: string
  connectionString: string
}

export interface StorageConfig {
  connectionString: string
}

export interface Config {
  migration: MigrationConfig
  storage: StorageConfig
}

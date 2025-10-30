export interface MigrationConfig {
  gooseExecutablePath?: string
  migrationListTableName: string
  connectionString: string
}

export interface WorkflowStorageConfig {
  connectionString: string
}

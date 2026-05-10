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
 * Validates a Postgres identifier (schema, table, etc.) — identifiers are
 * interpolated directly into SQL strings (Postgres parameterized queries can't
 * bind identifiers), so we lock them down at construction time. Two checks:
 * a strict ASCII regex (no spaces, quotes, or non-ASCII) and a 50-byte cap.
 * Postgres' raw limit is 63 bytes (NAMEDATALEN - 1), but it auto-derives
 * suffixed identifiers from table names (`<table>_pkey`, `<table>_<col>_fkey`,
 * `<table>_<col>_seq`, …); 50 bytes leaves ~13 bytes of headroom so those
 * derivatives don't silently truncate with a NOTICE.
 */
export function assertValidPostgresIdentifier(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid Postgres identifier: ${JSON.stringify(name)}. Must match /^[A-Za-z_][A-Za-z0-9_]*$/ (ASCII letter or underscore, then letters/digits/underscores).`);
  }
  const byteLength = Buffer.byteLength(name, 'utf8');
  if (byteLength > 50) {
    throw new Error(`Invalid Postgres identifier: ${JSON.stringify(name)} is ${byteLength} bytes; capped at 50 bytes to leave headroom for Postgres auto-derived identifiers (e.g. <name>_pkey, <name>_<col>_fkey, <name>_<col>_seq) within the 63-byte NAMEDATALEN limit.`);
  }
}

// Kept for backwards compatibility — delegates to assertValidPostgresIdentifier.
export function assertValidSchemaName(name: string): void {
  assertValidPostgresIdentifier(name);
}

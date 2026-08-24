import { createHash } from 'node:crypto';

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
   * collide on a global schema.
   */
  schemaName: string;
  /** Additional migration sets to run after skeleton migrations (e.g. vanilla-service) */
  additionalMigrations?: AdditionalMigration[];
}

/**
 * Max byte length we allow for any identifier we splice into SQL. Postgres'
 * raw limit is 63 bytes (NAMEDATALEN - 1), but it auto-derives suffixed
 * identifiers from table names (`<table>_pkey`, `<table>_<col>_fkey`,
 * `<table>_<col>_seq`, …); 50 bytes leaves ~13 bytes of headroom so those
 * derivatives don't silently truncate with a NOTICE.
 */
export const MAX_POSTGRES_IDENTIFIER_LENGTH = 50;

/**
 * Validates a Postgres identifier (schema, table, etc.) — identifiers are
 * interpolated directly into SQL strings (Postgres parameterized queries can't
 * bind identifiers), so we lock them down at construction time. Two checks:
 * a strict ASCII regex (no spaces, quotes, or non-ASCII) and the byte cap
 * documented on MAX_POSTGRES_IDENTIFIER_LENGTH.
 */
export function assertValidPostgresIdentifier(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid Postgres identifier: ${JSON.stringify(name)}. Must match /^[A-Za-z_][A-Za-z0-9_]*$/ (ASCII letter or underscore, then letters/digits/underscores).`);
  }
  const byteLength = Buffer.byteLength(name, 'utf8');
  if (byteLength > MAX_POSTGRES_IDENTIFIER_LENGTH) {
    throw new Error(`Invalid Postgres identifier: ${JSON.stringify(name)} is ${byteLength} bytes; capped at ${MAX_POSTGRES_IDENTIFIER_LENGTH} bytes to leave headroom for Postgres auto-derived identifiers (e.g. <name>_pkey, <name>_<col>_fkey, <name>_<col>_seq) within the 63-byte NAMEDATALEN limit.`);
  }
}

/**
 * Coerces an arbitrary string into a value that satisfies
 * assertValidPostgresIdentifier — non-[A-Za-z0-9_] characters become `_`,
 * a leading digit gets a `_` prefix. When the result exceeds
 * MAX_POSTGRES_IDENTIFIER_LENGTH it is truncated and an 8-char md5 suffix
 * derived from the original input is appended so distinct long inputs that
 * share a prefix don't collapse onto the same identifier. Throws on empty
 * input.
 */
export function toPostgresIdentifier(raw: string): string {
  if (raw.length === 0) {
    throw new Error('Cannot derive a Postgres identifier from an empty string.');
  }
  let sanitized = raw.replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }
  if (sanitized.length > MAX_POSTGRES_IDENTIFIER_LENGTH) {
    const hashSuffixLength = 8;
    const hashSuffix = createHash('md5').update(raw).digest('hex').slice(0, hashSuffixLength);
    const prefixLength = MAX_POSTGRES_IDENTIFIER_LENGTH - hashSuffixLength - 1;
    sanitized = `${sanitized.slice(0, prefixLength)}_${hashSuffix}`;
  }
  assertValidPostgresIdentifier(sanitized);
  return sanitized;
}

import { decrypt, encrypt, encryptWith, Mode, parse } from './cipher';
import { Keyring } from './keyring';
import { assertValidPostgresIdentifier } from '../config';

export interface ColumnSpec {
  mode: Mode;
}

export type ColumnsSpec<Row> = Partial<Record<keyof Row & string, ColumnSpec>>;

/** One value per keyring key, so `col = ANY(values)` survives a rotation. */
export interface Lookup {
  column: string;
  values: string[];
}

export class EncryptedColumns<Row extends Record<string, unknown>> {
  constructor(
    private readonly keyring: Keyring,
    private readonly table: string,
    private readonly spec: ColumnsSpec<Row>,
  ) {
    // names get spliced into the consumer's SQL
    for (const [column] of this.entries()) assertValidPostgresIdentifier(column);
  }

  private aad(column: string): string {
    return `${this.table}.${column}`;
  }

  private entries(): [string, ColumnSpec][] {
    return Object.entries(this.spec).filter((e): e is [string, ColumnSpec] => e[1] !== undefined);
  }

  toDb(row: Row): Record<string, unknown> {
    const out: Record<string, unknown> = { ...row };
    for (const [column, spec] of this.entries()) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string') {
        throw new Error(`${this.aad(column)}: encrypted columns take strings, got ${typeof value}`);
      }
      out[column] = encrypt(this.keyring, spec.mode, value, this.aad(column));
    }
    return out;
  }

  fromDb(db: Record<string, unknown>): Row {
    const out: Record<string, unknown> = { ...db };
    for (const [column] of this.entries()) {
      const value = db[column];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string') {
        throw new Error(`${this.aad(column)}: expected an encrypted string, got ${typeof value}`);
      }
      out[column] = decrypt(this.keyring, value, this.aad(column));
    }
    return out as Row;
  }

  /** Mid-rotation UNIQUE is per key: guard inserts with `NOT EXISTS (… = ANY(values))`. */
  where(column: keyof Row & string, value: string): Lookup {
    const spec = this.spec[column];
    if (!spec) throw new Error(`${this.aad(column)} is not an encrypted column`);
    if (spec.mode !== 'deterministic') {
      throw new Error(`${this.aad(column)} is encrypted in random mode and cannot be queried by value`);
    }
    const aad = this.aad(column);
    return { column, values: this.keyring.all().map((k) => encryptWith(k, 'deterministic', value, aad)) };
  }

  /** Rotation: `toDb(fromDb(row))` → UPDATE where non-empty, before dropping the old key. */
  staleColumns(db: Record<string, unknown>): string[] {
    const stale: string[] = [];
    for (const [column] of this.entries()) {
      const value = db[column];
      if (typeof value !== 'string') continue;
      const parsed = parse(value);
      if (!parsed || parsed.kid !== this.keyring.current.kid) stale.push(column);
    }
    return stale;
  }
}

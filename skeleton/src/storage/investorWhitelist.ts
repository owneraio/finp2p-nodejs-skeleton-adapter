import { Pool } from 'pg';
import { InvestorWhitelistStore, InvestorWhitelistRow } from './interfaces';
import { assertValidSchemaName, DEFAULT_SCHEMA_NAME } from './config';

interface DbRow {
  fin_id: string;
  asset_id: string;
  config: Record<string, unknown>;
}

const toRow = (r: DbRow): InvestorWhitelistRow => ({
  finId: r.fin_id,
  assetId: r.asset_id,
  config: r.config ?? {},
});

export class PgInvestorWhitelistStore implements InvestorWhitelistStore {

  private readonly schema: string;

  constructor(private pool: Pool, schemaName: string = DEFAULT_SCHEMA_NAME) {
    assertValidSchemaName(schemaName);
    this.schema = schemaName;
  }

  async upsert(row: InvestorWhitelistRow): Promise<InvestorWhitelistRow> {
    const { finId, assetId, config } = row;
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.investor_whitelist (fin_id, asset_id, config)
       VALUES ($1, $2, $3)
       ON CONFLICT (fin_id, asset_id)
         DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
       RETURNING *`,
      [finId, assetId, JSON.stringify(config)],
    );
    return toRow(result.rows[0]);
  }

  async get(finId: string, assetId: string): Promise<InvestorWhitelistRow | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.investor_whitelist WHERE fin_id = $1 AND asset_id = $2`,
      [finId, assetId],
    );
    return result.rows.length > 0 ? toRow(result.rows[0]) : undefined;
  }

  async list(finId?: string, assetId?: string): Promise<InvestorWhitelistRow[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (finId) {
      params.push(finId);
      where.push(`fin_id = $${params.length}`);
    }
    if (assetId) {
      params.push(assetId);
      where.push(`asset_id = $${params.length}`);
    }
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.investor_whitelist
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY fin_id ASC, asset_id ASC`,
      params,
    );
    return result.rows.map(toRow);
  }

  async remove(finId: string, assetId?: string): Promise<number> {
    const result = assetId
      ? await this.pool.query(
        `DELETE FROM ${this.schema}.investor_whitelist WHERE fin_id = $1 AND asset_id = $2`,
        [finId, assetId],
      )
      : await this.pool.query(
        `DELETE FROM ${this.schema}.investor_whitelist WHERE fin_id = $1`,
        [finId],
      );
    return result.rowCount ?? 0;
  }
}

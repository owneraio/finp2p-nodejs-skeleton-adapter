import { Pool } from 'pg';
import { InvestorWhitelistStore, InvestorWhitelistRow } from './interfaces';
import { assertValidSchemaName, DEFAULT_SCHEMA_NAME } from './config';
import { WhitelistParty, whitelistPartyId } from '../models';

interface DbRow {
  party_type: 'finId' | 'address';
  party_id: string;
  asset_id: string;
  config: Record<string, unknown>;
}

const toParty = (r: DbRow): WhitelistParty => (r.party_type === 'finId'
  ? { type: 'finId', finId: r.party_id }
  : { type: 'address', address: r.party_id });

const toRow = (r: DbRow): InvestorWhitelistRow => ({
  party: toParty(r),
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
    const { party, assetId, config } = row;
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.investor_whitelist (party_type, party_id, asset_id, config)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (party_type, party_id, asset_id)
         DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
       RETURNING *`,
      [party.type, whitelistPartyId(party), assetId, JSON.stringify(config)],
    );
    return toRow(result.rows[0]);
  }

  async get(party: WhitelistParty, assetId: string): Promise<InvestorWhitelistRow | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.investor_whitelist
       WHERE party_type = $1 AND party_id = $2 AND asset_id = $3`,
      [party.type, whitelistPartyId(party), assetId],
    );
    return result.rows.length > 0 ? toRow(result.rows[0]) : undefined;
  }

  async list(party?: WhitelistParty, assetId?: string): Promise<InvestorWhitelistRow[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (party) {
      params.push(party.type, whitelistPartyId(party));
      where.push(`party_type = $${params.length - 1} AND party_id = $${params.length}`);
    }
    if (assetId) {
      params.push(assetId);
      where.push(`asset_id = $${params.length}`);
    }
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.investor_whitelist
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY party_type ASC, party_id ASC, asset_id ASC`,
      params,
    );
    return result.rows.map(toRow);
  }

  async remove(party: WhitelistParty, assetId?: string): Promise<number> {
    const partyId = whitelistPartyId(party);
    const result = assetId
      ? await this.pool.query(
        `DELETE FROM ${this.schema}.investor_whitelist
         WHERE party_type = $1 AND party_id = $2 AND asset_id = $3`,
        [party.type, partyId, assetId],
      )
      : await this.pool.query(
        `DELETE FROM ${this.schema}.investor_whitelist
         WHERE party_type = $1 AND party_id = $2`,
        [party.type, partyId],
      );
    return result.rowCount ?? 0;
  }
}

import { Pool } from 'pg';
import { NetworkAccountRow, NetworkAccountStore } from './interfaces';
import { assertValidSchemaName, DEFAULT_SCHEMA_NAME } from './config';
import { NetworkAccount } from '../models';

interface DbRow {
  account_id: string;
  idempotency_key: string | null;
  organization_id: string;
  asset_id: string;
  fin_id: string;
  account: NetworkAccount;
}

const toRow = (db: DbRow): NetworkAccountRow => ({
  accountId: db.account_id,
  idempotencyKey: db.idempotency_key ?? undefined,
  organizationId: db.organization_id,
  assetId: db.asset_id,
  finId: db.fin_id,
  account: db.account,
});

export class PgNetworkAccountStore implements NetworkAccountStore {
  private readonly schema: string;

  constructor(private pool: Pool, schemaName: string = DEFAULT_SCHEMA_NAME) {
    assertValidSchemaName(schemaName);
    this.schema = schemaName;
  }

  /**
   * Insert the binding, or return the existing one for this
   * (organization, asset, finId).
   *
   * `ON CONFLICT DO NOTHING` rather than a read-then-insert: two concurrent
   * creates for the same triple would both see no row and both insert, and the
   * unique index would reject the loser with 23505 — surfacing as a 500. The
   * conflict target is `network_accounts_org_asset_fin_id_idx`, so the loser
   * gets no row back and re-selects the winner's instead. This is also one
   * round-trip fewer on the happy path.
   */
  async insert(row: NetworkAccountRow): Promise<NetworkAccountRow> {
    const { accountId, idempotencyKey, organizationId, assetId, finId, account } = row;
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.network_accounts
         (account_id, idempotency_key, organization_id, asset_id, fin_id, account)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, asset_id, fin_id) DO NOTHING
       RETURNING *`,
      [accountId, idempotencyKey ?? null, organizationId, assetId, finId, JSON.stringify(account)],
    );
    if (result.rows.length > 0) {
      return toRow(result.rows[0]);
    }
    const existing = await this.getByFinId(organizationId, assetId, finId);
    if (!existing) {
      // Only reachable if the conflicting row was deleted between the insert
      // and this re-select.
      throw new Error(`failed to insert or locate network account for ${organizationId}/${assetId}/${finId}`);
    }
    return existing;
  }

  async getByFinId(organizationId: string, assetId: string, finId: string): Promise<NetworkAccountRow | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.network_accounts
       WHERE organization_id = $1 AND asset_id = $2 AND fin_id = $3`,
      [organizationId, assetId, finId],
    );
    return result.rows.length > 0 ? toRow(result.rows[0]) : undefined;
  }

  async remove(accountId: string): Promise<NetworkAccountRow | undefined> {
    const result = await this.pool.query(
      `DELETE FROM ${this.schema}.network_accounts WHERE account_id = $1 RETURNING *`,
      [accountId],
    );
    return result.rows.length > 0 ? toRow(result.rows[0]) : undefined;
  }
}

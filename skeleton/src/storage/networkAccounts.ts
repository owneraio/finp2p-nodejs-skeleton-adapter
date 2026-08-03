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

  async insert(row: NetworkAccountRow): Promise<NetworkAccountRow> {
    const { accountId, idempotencyKey, organizationId, assetId, finId, account } = row;
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.network_accounts
         (account_id, idempotency_key, organization_id, asset_id, fin_id, account)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [accountId, idempotencyKey ?? null, organizationId, assetId, finId, JSON.stringify(account)],
    );
    return toRow(result.rows[0]);
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

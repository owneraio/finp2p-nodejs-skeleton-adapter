import { Pool } from 'pg';
import { Asset, AssetStore } from './interfaces';
import { assertValidPostgresIdentifier } from '../workflows/migrator';

export class PgAssetStore implements AssetStore {
  constructor(private pool: Pool, private readonly schemaName: string) {
    // schemaName is interpolated into SQL (Postgres can't parameter-bind
    // identifiers); validate at construction to minimize injection risk.
    assertValidPostgresIdentifier(schemaName);
  }

  async getAsset(assetId: string): Promise<Asset | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schemaName}.assets WHERE id = $1`,
      [assetId],
    );
    return result.rows.at(0);
  }

  async saveAsset(asset: Omit<Asset, 'created_at' | 'updated_at'>): Promise<Asset> {
    const result = await this.pool.query(
      `INSERT INTO ${this.schemaName}.assets (id, contract_address, decimals, token_standard)
       VALUES ($1, $2, $3, $4)
       RETURNING *;`,
      [asset.id, asset.contract_address, asset.decimals, asset.token_standard],
    );
    if (result.rows.length === 0) throw new Error('Failed to save asset to DB');
    return result.rows.at(0);
  }
}

import { Pool } from 'pg';
import { Asset, AssetStore } from './interfaces';

export class PgAssetStore implements AssetStore {
  constructor(private pool: Pool) {}

  async getAsset(assetId: string): Promise<Asset | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM ledger_adapter.assets WHERE id = $1',
      [assetId],
    );
    return result.rows.at(0);
  }

  async saveAsset(asset: Omit<Asset, 'created_at' | 'updated_at'>): Promise<Asset> {
    const result = await this.pool.query(
      `INSERT INTO ledger_adapter.assets (id, contract_address, decimals, token_standard)
       VALUES ($1, $2, $3, $4)
       RETURNING *;`,
      [asset.id, asset.contract_address, asset.decimals, asset.token_standard],
    );
    if (result.rows.length === 0) throw new Error('Failed to save asset to DB');
    return result.rows.at(0);
  }
}

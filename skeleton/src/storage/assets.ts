import { Pool } from 'pg';

export interface AssetRecord {
  type: string;
  id: string;
  token_standard: string;
  created_at: Date;
  updated_at: Date;
  contract_address: string;
  decimals: number;
}

export interface AssetStore {
  getAsset(asset: { id: string; type: string }): Promise<AssetRecord | undefined>;
  saveAsset(asset: Omit<AssetRecord, 'created_at' | 'updated_at'>): Promise<AssetRecord>;
}

export class PgAssetStore implements AssetStore {
  constructor(private pool: Pool) {}

  async getAsset(asset: { id: string; type: string }): Promise<AssetRecord | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM ledger_adapter.assets WHERE id = $1 AND type = $2',
      [asset.id, asset.type],
    );
    return result.rows.at(0);
  }

  async saveAsset(asset: Omit<AssetRecord, 'created_at' | 'updated_at'>): Promise<AssetRecord> {
    const result = await this.pool.query(
      `INSERT INTO ledger_adapter.assets (id, type, contract_address, decimals, token_standard)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *;`,
      [asset.id, asset.type, asset.contract_address, asset.decimals, asset.token_standard],
    );
    if (result.rows.length === 0) throw new Error('Failed to save asset to DB');
    return result.rows.at(0);
  }
}

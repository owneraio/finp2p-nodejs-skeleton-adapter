import { Pool } from 'pg';
import { Asset, AssetStore } from './interfaces';
import { assertValidSchemaName, DEFAULT_SCHEMA_NAME } from './config';

export class PgAssetStore implements AssetStore {
  private readonly schema: string;

  constructor(private pool: Pool, schemaName: string = DEFAULT_SCHEMA_NAME) {
    assertValidSchemaName(schemaName);
    this.schema = schemaName;
  }

  async getAsset(asset: { id: string; type: string }): Promise<Asset | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.assets WHERE id = $1 AND type = $2`,
      [asset.id, asset.type],
    );
    return result.rows.at(0);
  }

  async saveAsset(asset: Omit<Asset, 'created_at' | 'updated_at'>): Promise<Asset> {
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.assets (id, type, contract_address, decimals, token_standard)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *;`,
      [asset.id, asset.type, asset.contract_address, asset.decimals, asset.token_standard],
    );
    if (result.rows.length === 0) throw new Error('Failed to save asset to DB');
    return result.rows.at(0);
  }
}

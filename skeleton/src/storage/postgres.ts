import { Pool } from 'pg';
import { StorageConfig } from './config';
import { PgAccountMappingStore } from './account-mappings';
import { PgAssetStore } from './assets';

/**
 * Shared PostgreSQL context for non-workflow storage.
 * Creates the pool and exposes capability-level stores.
 */
export class SharedStorage {
  readonly pool: Pool;

  readonly accountMappings: PgAccountMappingStore;

  readonly assets: PgAssetStore;

  constructor(config: StorageConfig) {
    this.pool = new Pool({ connectionString: config.connectionString });
    this.accountMappings = new PgAccountMappingStore(this.pool);
    this.assets = new PgAssetStore(this.pool);
  }

  async close() {
    await this.pool.end();
  }
}

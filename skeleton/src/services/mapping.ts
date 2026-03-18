import { MappingService, OwnerMapping } from '@owneraio/finp2p-adapter-models';
import {
  getAccountMappings,
  saveAccountMapping,
  deleteAccountMapping,
} from '../workflows/storage';

/**
 * MappingService backed by the skeleton's built-in PostgreSQL storage.
 * Used when no external MappingService is provided.
 */
export class MappingServiceImpl implements MappingService {
  async getOwnerMappings(finIds?: string[]): Promise<OwnerMapping[]> {
    const rows = await getAccountMappings(finIds);
    return rows.map(r => ({ finId: r.fin_id, account: r.account }));
  }

  async saveOwnerMapping(finId: string, account: string): Promise<OwnerMapping> {
    const row = await saveAccountMapping(finId, account);
    return { finId: row.fin_id, account: row.account };
  }

  async deleteOwnerMapping(finId: string, account?: string): Promise<void> {
    await deleteAccountMapping(finId, account);
  }
}

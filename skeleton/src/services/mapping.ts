import { MappingService, OwnerMapping } from '../models';
import { AccountMappingStore } from '../storage';

/**
 * MappingService backed by a shared AccountMappingStore.
 */
export class MappingServiceImpl implements MappingService {
  private store: AccountMappingStore;

  constructor(store: AccountMappingStore) {
    this.store = store;
  }

  async getOwnerMappings(finIds?: string[]): Promise<OwnerMapping[]> {
    return this.store.getOwnerMappings(finIds);
  }

  async getByFieldValue(fieldName: string, value: string): Promise<OwnerMapping[]> {
    return this.store.getByFieldValue(fieldName, value);
  }

  async saveOwnerMapping(finId: string, fields: Record<string, string>): Promise<OwnerMapping> {
    return this.store.saveOwnerMapping(finId, fields);
  }

  async deleteOwnerMapping(finId: string, fieldName?: string): Promise<void> {
    await this.store.deleteOwnerMapping(finId, fieldName);
  }
}

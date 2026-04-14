import { MappingService, OwnerMapping } from '../models';
import { Storage } from '../workflows/storage';

/**
 * MappingService backed by the skeleton's built-in PostgreSQL storage.
 */
export class MappingServiceImpl implements MappingService {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async getOwnerMappings(finIds?: string[]): Promise<OwnerMapping[]> {
    return this.storage.getAccountMappings(finIds);
  }

  async getByFieldValue(fieldName: string, value: string): Promise<OwnerMapping[]> {
    return this.storage.getAccountMappingsByFieldValue(fieldName, value);
  }

  async saveOwnerMapping(finId: string, fields: Record<string, string>): Promise<OwnerMapping> {
    return this.storage.saveAccountMapping(finId, fields);
  }

  async deleteOwnerMapping(finId: string, fieldName?: string): Promise<void> {
    await this.storage.deleteAccountMapping(finId, fieldName);
  }
}

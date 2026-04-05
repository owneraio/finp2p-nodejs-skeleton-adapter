import { MappingService, OwnerMapping } from '../models';
import {
  getAccountMappings,
  getAccountMappingsByFieldValue,
  saveAccountMapping,
  deleteAccountMapping,
} from '../workflows/storage';

/**
 * MappingService backed by the skeleton's built-in PostgreSQL storage.
 * Used when no external MappingService is provided.
 */
export class MappingServiceImpl implements MappingService {
  async getOwnerMappings(finIds?: string[]): Promise<OwnerMapping[]> {
    return getAccountMappings(finIds);
  }

  async getByFieldValue(fieldName: string, value: string): Promise<OwnerMapping[]> {
    return getAccountMappingsByFieldValue(fieldName, value);
  }

  async saveOwnerMapping(finId: string, fields: Record<string, string>): Promise<OwnerMapping> {
    return saveAccountMapping(finId, fields);
  }

  async deleteOwnerMapping(finId: string, fieldName?: string): Promise<void> {
    await deleteAccountMapping(finId, fieldName);
  }
}

import { NetworkMappingService, NetworkMapping } from '../models';
import {
  getNetworkMappings,
  saveNetworkMapping,
  deleteNetworkMapping,
} from '../workflows/storage';

/**
 * NetworkMappingService backed by the skeleton's built-in PostgreSQL storage.
 */
export class NetworkMappingServiceImpl implements NetworkMappingService {
  async getNetworkMappings(networkIds?: string[]): Promise<NetworkMapping[]> {
    return getNetworkMappings(networkIds);
  }

  async saveNetworkMapping(networkId: string, fields: Record<string, string>): Promise<NetworkMapping> {
    return saveNetworkMapping(networkId, fields);
  }

  async deleteNetworkMapping(networkId: string, fieldName?: string): Promise<void> {
    await deleteNetworkMapping(networkId, fieldName);
  }
}

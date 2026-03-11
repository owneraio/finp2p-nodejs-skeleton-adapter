import { MappingAPI } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import axios from 'axios';

type CreateOwnerMappingRequest = MappingAPI['schemas']['createOwnerMappingRequest'];
type CreateOwnerMappingResponse = MappingAPI['schemas']['createOwnerMappingResponse'];
type OwnerMapping = MappingAPI['schemas']['ownerMapping'];
type AccountMappingField = MappingAPI['schemas']['accountMappingField'];

export class MappingLedgerAPI {
  private host: string;

  constructor(host: string) {
    this.host = host;
  }

  async createOwnerMapping(req: CreateOwnerMappingRequest): Promise<CreateOwnerMappingResponse> {
    const { data } = await axios.post(`${this.host}/mapping/owners`, req, {
      headers: { 'Content-Type': 'application/json' },
    });
    return data;
  }

  async getOwnerMappings(finIds?: string[]): Promise<OwnerMapping[]> {
    const params = finIds ? { finIds: finIds.join(',') } : {};
    const { data } = await axios.get(`${this.host}/mapping/owners`, { params });
    return data;
  }

  async getMappingFields(): Promise<AccountMappingField[]> {
    const { data } = await axios.get(`${this.host}/mapping/fields`);
    return data;
  }
}

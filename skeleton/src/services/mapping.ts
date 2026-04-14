import { AccountMappingService, AccountMapping } from '../models';
import { AccountStore } from '../storage';

/**
 * AccountMappingService backed by a shared AccountStore.
 */
export class AccountMappingServiceImpl implements AccountMappingService {
  private store: AccountStore;

  constructor(store: AccountStore) {
    this.store = store;
  }

  async getAccounts(finIds?: string[]): Promise<AccountMapping[]> {
    return this.store.getAccounts(finIds);
  }

  async getByFieldValue(fieldName: string, value: string): Promise<AccountMapping[]> {
    return this.store.getByFieldValue(fieldName, value);
  }

  async saveAccount(finId: string, fields: Record<string, string>): Promise<AccountMapping> {
    return this.store.saveAccount(finId, fields);
  }

  async deleteAccount(finId: string, fieldName?: string): Promise<void> {
    await this.store.deleteAccount(finId, fieldName);
  }
}

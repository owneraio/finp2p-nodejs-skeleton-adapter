import { AccountMappingService, AccountMapping } from '../models';
import { AccountStore } from '../storage';

export interface AccountMappingOptions {
  /**
   * Match account-mapping field values case-sensitively. Default: true.
   *
   * When false, the service lowercases values on both save and lookup so a
   * caller looking up `0xABC...` finds an account saved as `0xabc...` and
   * vice versa. Useful for ledger account fields that consumers may submit
   * mixed-case (e.g. EIP-55 checksummed Ethereum addresses) when the
   * underlying address space is logically case-insensitive.
   *
   * Trade-off: case-insensitive mode discards the original casing at write
   * time. If the adapter cares about preserving display casing, leave this
   * at the default and rely on callers to canonicalize before submitting.
   */
  caseSensitive?: boolean;
}

/**
 * AccountMappingService backed by a shared AccountStore.
 */
export class AccountMappingServiceImpl implements AccountMappingService {
  private readonly caseSensitive: boolean;

  constructor(private store: AccountStore, options?: AccountMappingOptions) {
    this.caseSensitive = options?.caseSensitive ?? true;
  }

  async getAccounts(finIds?: string[]): Promise<AccountMapping[]> {
    return this.store.getAccounts(finIds);
  }

  async getByFieldValue(fieldName: string, value: string): Promise<AccountMapping[]> {
    return this.store.getByFieldValue(fieldName, this.normalize(value));
  }

  async saveAccount(finId: string, fields: Record<string, string>): Promise<AccountMapping> {
    return this.store.saveAccount(finId, this.normalizeFields(fields));
  }

  async deleteAccount(finId: string, fieldName?: string): Promise<void> {
    await this.store.deleteAccount(finId, fieldName);
  }

  private normalize(value: string): string {
    return this.caseSensitive ? value : value.toLowerCase();
  }

  private normalizeFields(fields: Record<string, string>): Record<string, string> {
    if (this.caseSensitive) return fields;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) out[k] = v.toLowerCase();
    return out;
  }
}

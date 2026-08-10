import {
  InvestorWhitelistEntry,
  InvestorWhitelistService,
  InvestorWhitelistValidator,
  WhitelistParty,
} from '../../models';
import { InvestorWhitelistStore } from '../../storage';

/**
 * Whitelist entries kept in the adapter's own store.
 *
 * Use this when whitelist state genuinely lives off-ledger. If the ledger
 * enforces membership itself, implement `InvestorWhitelistService` against it
 * instead and do not use this class — rows here would drift from ledger truth as
 * soon as anything mutates the ledger directly.
 */
export class InvestorWhitelistServiceImpl implements InvestorWhitelistService {

  constructor(
    protected readonly store: InvestorWhitelistStore,
    protected readonly validator?: InvestorWhitelistValidator,
  ) {
  }

  async whitelist(
    party: WhitelistParty, assetId: string, config: Record<string, unknown>,
  ): Promise<InvestorWhitelistEntry> {
    const validated = this.validator
      ? await this.validator.validate(party, assetId, config)
      : config;
    const row = await this.store.upsert({ party, assetId, config: validated });
    return { party: row.party, assetId: row.assetId, config: row.config };
  }

  async dewhitelist(party: WhitelistParty, assetId?: string): Promise<number> {
    return this.store.remove(party, assetId);
  }

  async getWhitelist(party?: WhitelistParty, assetId?: string): Promise<InvestorWhitelistEntry[]> {
    const rows = await this.store.list(party, assetId);
    return rows.map(r => ({ party: r.party, assetId: r.assetId, config: r.config }));
  }

  async isWhitelisted(party: WhitelistParty, assetId: string): Promise<boolean> {
    return (await this.store.get(party, assetId)) !== undefined;
  }
}

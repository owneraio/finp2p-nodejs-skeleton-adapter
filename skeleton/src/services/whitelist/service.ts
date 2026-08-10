import {
  InvestorWhitelistEntry,
  InvestorWhitelistService,
  InvestorWhitelistValidator,
} from '../../models';
import { InvestorWhitelistStore } from '../../storage';

export class InvestorWhitelistServiceImpl implements InvestorWhitelistService {

  constructor(
    protected readonly store: InvestorWhitelistStore,
    protected readonly validator?: InvestorWhitelistValidator,
  ) {
  }

  async whitelist(finId: string, assetId: string, config: Record<string, unknown>): Promise<InvestorWhitelistEntry> {
    const validated = this.validator
      ? await this.validator.validate(finId, assetId, config)
      : config;
    const row = await this.store.upsert({ finId, assetId, config: validated });
    return { finId: row.finId, assetId: row.assetId, config: row.config };
  }

  async dewhitelist(finId: string, assetId?: string): Promise<number> {
    return this.store.remove(finId, assetId);
  }

  async getWhitelist(finId?: string, assetId?: string): Promise<InvestorWhitelistEntry[]> {
    const rows = await this.store.list(finId, assetId);
    return rows.map(r => ({ finId: r.finId, assetId: r.assetId, config: r.config }));
  }

  async isWhitelisted(finId: string, assetId: string): Promise<boolean> {
    return (await this.store.get(finId, assetId)) !== undefined;
  }
}

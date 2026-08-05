import { OssClient, OssExecutionPlan, parseProofDomain, ProofPolicy } from './oss';
import { FinAPIClient } from './finapi';
import { components as FinAPIComponents } from './finapi/model-gen';
import { components as OpComponents } from './finapi/op-model-gen';
import { sleep } from './finapi/utils';


export class FinP2PClient {

  finAPIClient: FinAPIClient;

  ossClient: OssClient;

  constructor(finAPIUrl: string, ossUrl: string, authTokenResolver?: (() => string)) {
    this.finAPIClient = new FinAPIClient(finAPIUrl, authTokenResolver);
    this.ossClient = new OssClient(ossUrl, authTokenResolver);
  }

  /**
   * Build a client from a single router base URL. Hides the `/finapi` and
   * `/oss/query` suffix split so callers don't have to know the SDK's internal
   * URL convention. Trailing slashes on `baseUrl` are stripped.
   */
  static fromBaseUrl(baseUrl: string, authTokenResolver?: (() => string)): FinP2PClient {
    const base = baseUrl.replace(/\/+$/, '');
    return new FinP2PClient(`${base}/finapi`, `${base}/oss/query`, authTokenResolver);
  }

  // ── Owner / Profile ──

  async createOwner() {
    return this.finAPIClient.createOwner();
  }

  async createAsset(...args: Parameters<FinAPIClient['createAsset']>) {
    return this.finAPIClient.createAsset(...args);
  }

  async updateAsset(...args: Parameters<FinAPIClient['patchAsset']>) {
    return this.finAPIClient.patchAsset(...args);
  }

  async shareProfile(...args: Parameters<FinAPIClient['shareProfile']>) {
    return this.finAPIClient.shareProfile(...args);
  }

  async createCertificate(...args: Parameters<FinAPIClient['createCertificate']>) {
    return this.finAPIClient.createCertificate(...args);
  }

  async createOwnerAccount(...args: Parameters<FinAPIClient['createOwnerAccount']>) {
    return this.finAPIClient.createOwnerAccount(...args);
  }

  // ── Investor network accounts (onboarding) ──

  async createInvestorAccount(...args: Parameters<FinAPIClient['createInvestorAccount']>) {
    return this.finAPIClient.createInvestorAccount(...args);
  }

  async bindInvestorAccount(...args: Parameters<FinAPIClient['bindInvestorAccount']>) {
    return this.finAPIClient.bindInvestorAccount(...args);
  }

  async submitAccountProof(...args: Parameters<FinAPIClient['submitAccountProof']>) {
    return this.finAPIClient.submitAccountProof(...args);
  }

  async removeInvestorAccount(...args: Parameters<FinAPIClient['removeInvestorAccount']>) {
    return this.finAPIClient.removeInvestorAccount(...args);
  }

  /** Read back an investor's onboarded network accounts from the OSS read model. */
  async getOwnerNetworkAccounts(...args: Parameters<OssClient['getOwnerNetworkAccounts']>) {
    return this.ossClient.getOwnerNetworkAccounts(...args);
  }

  // ── Intent creation / execution ──

  async createIntent(...args: Parameters<FinAPIClient['createIntent']>) {
    return this.finAPIClient.createIntent(...args);
  }

  async executeIntent(...args: Parameters<FinAPIClient['executeIntent']>) {
    return this.finAPIClient.executeIntent(...args);
  }

  async cancelExecution(...args: Parameters<FinAPIClient['cancelExecution']>) {
    return this.finAPIClient.cancelExecution(...args);
  }

  async resetExecution(...args: Parameters<FinAPIClient['resetExecution']>) {
    return this.finAPIClient.resetExecution(...args);
  }

  // ── Deposit ──

  async createDeposit(...args: Parameters<FinAPIClient['createDeposit']>) {
    return this.finAPIClient.createDeposit(...args);
  }

  // ── Balance sync ──

  async syncBalance(...args: Parameters<FinAPIClient['syncBalance']>) {
    return this.finAPIClient.syncBalance(...args);
  }

  /**
   * Trigger balance sync for a specific owner + asset.
   * The router will call the adapter's getBalance endpoint to refresh the balance.
   */
  async syncBalanceForOwner(finId: string, orgId: string, assetId: string) {
    return this.finAPIClient.syncBalance({
      account: { type: 'finId', finId, orgId, custodian: { orgId } },
      asset: { resourceId: assetId },
    });
  }

  // ── Operations ──

  async getOperationStatus(id: string) {
    return this.finAPIClient.getOperationStatus(id);
  }

  async sendCallback(cid: string, operationStatus: OpComponents['schemas']['operationStatus']) {
    return this.finAPIClient.sendCallback(cid, operationStatus);
  }

  async importTransactions(transactions: OpComponents['schemas']['transaction'][]) {
    return this.finAPIClient.importTransactions(transactions);
  }

  async getExecutionPlan(planId: string) {
    return this.finAPIClient.getExecutionPlan(planId);
  }

  async waitForOperationCompletion(cid: string, timeoutMs: number): Promise<FinAPIComponents['schemas']['operationResponse']> {
    return this.finAPIClient.waitForOperationCompletion(cid, timeoutMs);
  }

  // ── Ledger management ──

  async bindLedger(...args: Parameters<FinAPIClient['bindLedger']>) {
    return this.finAPIClient.bindLedger(...args);
  }

  async updateLedger(...args: Parameters<FinAPIClient['updateLedger']>) {
    return this.finAPIClient.updateLedger(...args);
  }

  /**
   * Bind a ledger, falling back to update when the router reports a 409
   * (the name is already bound). Returns `"created"` for the bind path,
   * `"updated"` for the conflict-fall-through. The update path uses the
   * `name` from the bind body and the same body shape.
   *
   * Assumes the server uses HTTP 409 to signal "already bound" — if that
   * contract changes, this helper will misclassify and silently fall back.
   */
  async upsertLedgerBinding(
    body: Parameters<FinAPIClient['bindLedger']>[0],
  ): Promise<'created' | 'updated'> {
    const result = await this.finAPIClient.bindLedger(body);
    if ((result as any)?.response?.status === 409) {
      await (this.finAPIClient as any).updateLedger((body as any).name, body);
      return 'updated';
    }
    if ((result as any)?.error) {
      throw new Error(`upsertLedgerBinding: ${JSON.stringify((result as any).error)}`);
    }
    return 'created';
  }

  // ── Custody provider management ──

  async bindCustodyProvider(...args: Parameters<FinAPIClient['bindCustodyProvider']>) {
    return this.finAPIClient.bindCustodyProvider(...args);
  }

  async updateCustodyProvider(...args: Parameters<FinAPIClient['updateCustodyProvider']>) {
    return this.finAPIClient.updateCustodyProvider(...args);
  }

  /**
   * Bind a custody provider, falling back to update when the router reports
   * a 409 (the name is already bound). See `upsertLedgerBinding` for the
   * same caveats around the 409 contract.
   */
  async upsertCustodyProvider(
    body: Parameters<FinAPIClient['bindCustodyProvider']>[0],
  ): Promise<'created' | 'updated'> {
    const result = await this.finAPIClient.bindCustodyProvider(body);
    if ((result as any)?.response?.status === 409) {
      await (this.finAPIClient as any).updateCustodyProvider((body as any).name, body);
      return 'updated';
    }
    if ((result as any)?.error) {
      throw new Error(`upsertCustodyProvider: ${JSON.stringify((result as any).error)}`);
    }
    return 'created';
  }

  // ── Approval routing ──

  async setApprovalRouting(...args: Parameters<FinAPIClient['setApprovalRouting']>) {
    return this.finAPIClient.setApprovalRouting(...args);
  }

  async updateApprovalRouting(...args: Parameters<FinAPIClient['updateApprovalRouting']>) {
    return this.finAPIClient.updateApprovalRouting(...args);
  }

  // ── Policies ──

  async getPolicy(...args: Parameters<FinAPIClient['getPolicy']>) {
    return this.finAPIClient.getPolicy(...args);
  }

  async getAssetPolicies(...args: Parameters<FinAPIClient['getAssetPolicies']>) {
    return this.finAPIClient.getAssetPolicies(...args);
  }

  async createPolicy(...args: Parameters<FinAPIClient['createPolicy']>) {
    return this.finAPIClient.createPolicy(...args);
  }

  async updatePolicy(...args: Parameters<FinAPIClient['updatePolicy']>) {
    return this.finAPIClient.updatePolicy(...args);
  }

  async deletePolicy(...args: Parameters<FinAPIClient['deletePolicy']>) {
    return this.finAPIClient.deletePolicy(...args);
  }

  // ── OSS queries ──

  async updateCertificate(...args: Parameters<FinAPIClient['updateCertificate']>) {
    return this.finAPIClient.updateCertificate(...args);
  }

  async getAssets(...args: Parameters<OssClient['getAssets']>) {
    return this.ossClient.getAssets(...args);
  }

  async getUsers(...args: Parameters<OssClient['getUsers']>) {
    return this.ossClient.getUsers(...args);
  }

  async getAsset(assetId: string) {
    return this.ossClient.getAsset(assetId);
  }

  async getAssetProofPolicy(assetCode: string, assetType: string): Promise<ProofPolicy> {
    // v0.28 OSS schema only exposes proof policies for finp2p assets.
    // Fiat / cryptocurrency payment assets no longer have a proof policy endpoint.
    if (assetType !== 'finp2p') {
      return { type: 'NoProofPolicy' };
    }
    const { policies: { proof }, config: configRaw } = await this.getAsset(assetCode);
    const domain = parseProofDomain(configRaw);
    switch (proof.type) {
      case 'NoProofPolicy':
        return { type: 'NoProofPolicy' };
      case 'SignatureProofPolicy': {
        return { ...proof, domain };
      }
    }
  }

  async getOwnerByFinId(finId: string) {
    return this.ossClient.getOwnerByFinId(finId);
  }

  async getOwnerById(id: string) {
    return this.ossClient.getOwnerById(id);
  }

  async getOrganization(orgId: string) {
    return this.ossClient.getOrganization(orgId);
  }

  async getOwnerBalances(assetId: string) {
    return this.ossClient.getOwnerBalances(assetId);
  }

  async getSyncedBalances(assetId: string) {
    return this.ossClient.getSyncedBalances(assetId);
  }

  async getOwnerSyncedBalance(ownerId: string, assetId: string) {
    return this.ossClient.getOwnerSyncedBalance(ownerId, assetId);
  }

  async getOwnerHoldings(ownerId: string) {
    return this.ossClient.getOwnerHoldings(ownerId);
  }

  async getReceipts(...args: Parameters<OssClient['getReceipts']>) {
    return this.ossClient.getReceipts(...args);
  }

  async getCertificates(profileId: string) {
    return this.ossClient.getCertificates(profileId);
  }

  async getLedgers() {
    return this.ossClient.getLedgers();
  }

  async getLedger(name: string) {
    return this.ossClient.getLedger(name);
  }

  async getApprovalConfigs() {
    return this.ossClient.getApprovalConfigs();
  }

  // ── Plan queries (OSS GraphQL) ──

  async getExecutionPlanFromOss(planId: string): Promise<OssExecutionPlan> {
    return this.ossClient.getExecutionPlan(planId);
  }

  async getExecutionPlans(): Promise<OssExecutionPlan[]> {
    return this.ossClient.getExecutionPlans();
  }

  // ── Plan polling with status logging ──

  async waitForExecutionPlanCompletion(
    planId: string,
    options: {
      delay?: number;
      maxTimes?: number;
      onStatusChange?: (plan: OssExecutionPlan, transition: string) => void;
    } = {},
  ): Promise<OssExecutionPlan> {
    const { delay = 500, maxTimes = 3000 } = options;
    const terminalStatuses = ['Completed', 'Failed', 'Halted', 'Rejected', 'Cancelled'];

    let prevStatus: string | null = null;
    let prevInstructionStatuses: string[] = [];

    for (let i = 0; i < maxTimes; i += 1) {
      await sleep(delay);

      let plan: OssExecutionPlan;
      try {
        plan = await this.ossClient.getExecutionPlan(planId);
      } catch {
        continue;
      }

      const instructionStatuses = plan.instructions.map(
        (ins) => `${ins.sequence}:${ins.status}`,
      );
      let instructionsChanged = false;
      for (let j = 0; j < instructionStatuses.length; j += 1) {
        if (instructionStatuses[j] !== prevInstructionStatuses[j]) {
          instructionsChanged = true;
          break;
        }
      }

      if (plan.status !== prevStatus || (instructionsChanged && prevInstructionStatuses.length > 0)) {
        const transition = prevStatus ? `${prevStatus} → ${plan.status}` : plan.status;

        if (options.onStatusChange) {
          options.onStatusChange(plan, transition);
        } else {
          const instructions = plan.instructions.map((ins) => {
            const d = ins.details;
            const type = d.__typename?.replace('Instruction', '').toLowerCase() ?? 'unknown';
            let desc = `#${ins.sequence} ${type} [${ins.status}]`;
            if (d.amount) desc += ` amount=${d.amount}`;
            if (ins.state.__typename === 'ErrorState') {
              desc += ` error=(${ins.state.code}) ${ins.state.message}`;
            }
            return desc;
          }).join('\n    ');
          console.log(`  [plan ${plan.id}] ${transition}\n    ${instructions}`);
        }
      }

      prevStatus = plan.status;
      prevInstructionStatuses = instructionStatuses;

      if (terminalStatuses.includes(plan.status)) {
        return plan;
      }
    }

    // Log pending approvals to help diagnose stuck plans
    try {
      const lastPlan = await this.ossClient.getExecutionPlan(planId);
      const pending = lastPlan.approvals.filter((a) => a.status !== 'approved' && a.status !== 'Approved');
      if (pending.length > 0) {
        console.error(`Plan ${planId} stuck — pending approvals: ${pending.map((a) => `${a.orgId}(${a.status})`).join(', ')}`);
      }
    } catch {
      // ignore
    }

    throw new Error(`Execution plan ${planId} did not complete within ${maxTimes * delay}ms`);
  }

  /**
   * Poll an owner's holding for the given asset until the balance matches
   * `expected` (within `delta`), or `maxTimes * delay`ms elapses.
   *
   * `kind` selects which fields must match:
   *   - `'synced'` (default): the on-chain-synced view (`syncedBalance`).
   *   - `'internal'`: the local ledger view (`balance`).
   *   - `'both'`: both views must match.
   *
   * Resolves `true` on first match, `false` if the polling window runs out.
   * Useful in e2e flows where the synced view trails the ledger move.
   */
  async waitForOwnerBalance(
    ownerId: string,
    assetId: string,
    expected: number,
    opts: { kind?: 'internal' | 'synced' | 'both'; delta?: number; delay?: number; maxTimes?: number } = {},
  ): Promise<boolean> {
    const { kind = 'synced', delta = 0.01, delay = 500, maxTimes = 30 } = opts;
    for (let i = 0; i < maxTimes; i++) {
      try {
        const holdings = await this.ossClient.getOwnerHoldings(ownerId);
        const holding = holdings.find((h) => h.asset.resourceId === assetId);
        if (holding) {
          const close = (v: string) => Math.abs(parseFloat(v) - expected) <= delta;
          const internal = close(holding.balance);
          const synced = close(holding.syncedBalance);
          if (kind === 'internal' && internal) return true;
          if (kind === 'synced' && synced) return true;
          if (kind === 'both' && internal && synced) return true;
        }
      } catch {
        // holding may not exist yet
      }
      await sleep(delay);
    }
    return false;
  }

  async waitForSyncedBalance(
    ownerId: string,
    assetId: string,
    expectedBalance: string,
    options: { delay?: number; maxTimes?: number } = {},
  ): Promise<string> {
    const { delay = 500, maxTimes = 60 } = options;
    for (let i = 0; i < maxTimes; i++) {
      try {
        const balance = await this.getOwnerSyncedBalance(ownerId, assetId);
        if (balance === expectedBalance) return balance;
      } catch {
        // holding may not exist yet
      }
      await sleep(delay);
    }
    const lastBalance = await this.getOwnerSyncedBalance(ownerId, assetId).catch(() => 'N/A');
    throw new Error(`Synced balance for ${ownerId}/${assetId} did not reach ${expectedBalance} within ${maxTimes * delay}ms (last: ${lastBalance})`);
  }

}

import { OssClient, OssExecutionPlan, parseProofDomain, Proof, ProofDomain, ProofPolicy } from './oss';
import { FinAPIClient } from './finapi';
import { components as FinAPIComponents } from './finapi/model-gen';
import { components as OpComponents } from './finapi/op-model-gen';
import { ItemNotFoundError } from './oss/errors';
import { sleep } from './finapi/utils';


export class FinP2PClient {

  finAPIClient: FinAPIClient;

  ossClient: OssClient;

  constructor(finAPIUrl: string, ossUrl: string, authTokenResolver?: (() => string)) {
    this.finAPIClient = new FinAPIClient(finAPIUrl, authTokenResolver);
    this.ossClient = new OssClient(ossUrl, authTokenResolver);
  }

  // ── Owner / Profile ──

  async createAsset(...args: Parameters<FinAPIClient['createAsset']>) {
    return this.finAPIClient.createAsset(...args);
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
      account: { type: 'finId', finId, orgId },
      asset: { type: 'finp2p', resourceId: assetId },
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

  async getAssets(filter?: Parameters<OssClient['getAssets']>[0]) {
    return this.ossClient.getAssets(filter);
  }

  async getAsset(assetId: string) {
    return this.ossClient.getAsset(assetId);
  }

  async getAssetProofPolicy(assetCode: string, assetType: string, paymentOrgId: string): Promise<ProofPolicy> {
    let proof: Proof;
    let domain: ProofDomain | null = null;
    let configRaw: string;
    switch (assetType) {
      case 'finp2p': {
        ({ policies: { proof }, config: configRaw } = await this.getAsset(assetCode));
        domain = parseProofDomain(configRaw);
        break;
      }
      case 'cryptocurrency':
      case 'fiat': {
        try {
          ({ policies: { proof } } = await this.getPaymentAsset(paymentOrgId, assetCode));
        } catch (e) {
          if (e instanceof ItemNotFoundError) {
            return { type: 'NoProofPolicy' };
          }
          throw e;
        }
        break;
      }
      default:
        throw new Error(`Unknown asset type: ${assetType}`);
    }

    switch (proof.type) {
      case 'NoProofPolicy':
        return { type: 'NoProofPolicy' };
      case 'SignatureProofPolicy': {
        return { ...proof, domain };
      }
    }
  }

  async getPaymentAssets() {
    return this.ossClient.getPaymentAssets();
  }

  async getPaymentAsset(orgId: string, assetCode: string) {
    return this.ossClient.getPaymentAsset(orgId, assetCode);
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

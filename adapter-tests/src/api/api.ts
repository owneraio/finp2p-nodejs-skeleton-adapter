import { LedgerAPI } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { MockServer } from '../mock-server';
import { ClientError } from '../utils/error';
import { OpenAPIValidator } from '../utils/openapi-validator';
import { sleep } from '../utils/utils';
import { ClientBase } from './base';

export class TokensLedgerAPI extends ClientBase {

  public async createAsset(req: LedgerAPI['schemas']['CreateAssetRequest']): Promise<LedgerAPI['schemas']['CreateAssetResponse']> {
    return this.post('/assets/create', req);
  }

  public async issue(req: LedgerAPI['schemas']['IssueAssetsRequest']): Promise<LedgerAPI['schemas']['IssueAssetsResponse']> {
    return this.post('/assets/issue', req);
  }

  public async redeem(req: LedgerAPI['schemas']['RedeemAssetsRequest']): Promise<LedgerAPI['schemas']['RedeemAssetsResponse']> {
    return this.post('/assets/redeem', req);
  }

  public async transfer(req: LedgerAPI['schemas']['TransferAssetRequest']): Promise<LedgerAPI['schemas']['TransferAssetResponse']> {
    return this.post('/assets/transfer', req);
  }

}

export class EscrowLedgerAPI extends ClientBase {

  public async hold(req: LedgerAPI['schemas']['HoldOperationRequest']): Promise<LedgerAPI['schemas']['HoldOperationResponse']> {
    return this.post('/assets/hold', req);
  }

  public async release(req: LedgerAPI['schemas']['ReleaseOperationRequest']): Promise<LedgerAPI['schemas']['ReleaseOperationResponse']> {
    return this.post('/assets/release', req);
  }

  public async rollback(req: LedgerAPI['schemas']['RollbackOperationRequest']): Promise<LedgerAPI['schemas']['RollbackOperationResponse']> {
    return this.post('/assets/rollback', req);
  }
}

export class PaymentsLedgerAPI extends ClientBase {

  public async getDepositInstruction(req: LedgerAPI['schemas']['DepositInstructionRequest']): Promise<LedgerAPI['schemas']['DepositInstructionResponse']> {
    return this.post('/payments/depositInstruction', req);
  }

  public async payout(req: LedgerAPI['schemas']['PayoutRequest']): Promise<LedgerAPI['schemas']['PayoutResponse']> {
    return this.post('/payments/payout', req);
  }
}

export class PlanLedgerAPI extends ClientBase {

  public async approvePlan(req: LedgerAPI['schemas']['ApproveExecutionPlanRequest']): Promise<LedgerAPI['schemas']['ApproveExecutionPlanResponse']> {
    return this.post('/plan/approve', req);
  }

  public async proposal(req: LedgerAPI['schemas']['executionPlanProposalRequest']): Promise<LedgerAPI['schemas']['ApproveExecutionPlanResponse']> {
    return this.post('/plan/proposal', req);
  }

  public async proposalStatus(req: LedgerAPI['schemas']['executionPlanProposalStatusRequest']): Promise<void> {
    return this.post('/plan/proposal/status', req);
  }
}

export class CommonLedgerAPI extends ClientBase {

  public async getReceipt(id: string): Promise<LedgerAPI['schemas']['GetReceiptResponse']> {
    return this.get(`/assets/receipts/${id}`);
  }

  public async getOperationStatus(id: string): Promise<LedgerAPI['schemas']['GetOperationStatusResponse']> {
    return this.get(`/operations/status/${id}`);
  }

  public async getBalance(req: LedgerAPI['schemas']['GetAssetBalanceRequest']): Promise<LedgerAPI['schemas']['GetAssetBalanceResponse']> {
    return this.post('/assets/getBalance', req);
  }
}


export class LedgerAPIClient {

  public readonly tokens: TokensLedgerAPI;

  public readonly escrow: EscrowLedgerAPI;

  public readonly payments: PaymentsLedgerAPI;

  public readonly plan: PlanLedgerAPI;

  public readonly common: CommonLedgerAPI;

  public readonly callbackServer: MockServer | undefined;

  constructor(host: string, callbackServer?: MockServer) {
    this.tokens = new TokensLedgerAPI(host);
    this.escrow = new EscrowLedgerAPI(host);
    this.payments = new PaymentsLedgerAPI(host);
    this.plan = new PlanLedgerAPI(host);
    this.common = new CommonLedgerAPI(host);
    this.callbackServer = callbackServer;
  }

  async expectBalance(owner: LedgerAPI['schemas']['source'], asset: LedgerAPI['schemas']['asset'], amount: number) {
    const balance = await this.common.getBalance({ asset: asset, owner: owner });
    expect(parseInt(balance.balance)).toBe(amount);
  }

}

import { ClientBase } from './base';
import { LedgerAPI } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { ClientError } from '../utils/error';
import { sleep } from '../utils/utils';

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

export class CommonLedgerAPI extends ClientBase {

  public async getReceipt(id: string): Promise<LedgerAPI['schemas']['GetReceiptResponse']> {
    return this.post(`/assets/receipt/${id}`);
  }

  public async getOperationStatus(id: string): Promise<LedgerAPI['schemas']['GetOperationStatusResponse']> {
    return this.get(`/operations/status/${id}`);
  }

  public async getBalance(req: LedgerAPI['schemas']['GetAssetBalanceRequest']): Promise<LedgerAPI['schemas']['GetAssetBalanceResponse']> {
    return this.post('/assets/getBalance', req);
  }


  public async waitForReceipt(id: string, tries: number = 30): Promise<LedgerAPI['schemas']['receipt']> {
    for (let i = 1; i < tries; i++) {
      const status = await this.getOperationStatus(id);
      if (status.type === 'receipt') {
        if (status.operation.isCompleted) {
          return (status.operation).response!;
        }
      } else {
        throw new ClientError(`wrong status type, deposit expected, got: ${status.type}`);
      }
      await sleep(500);
    }
    throw new ClientError(`no result after ${tries} retries`);
  }

  public async waitForCompletion(id: string, tries: number = 3000) {
    for (let i = 1; i < tries; i++) {
      const status = await this.getOperationStatus(id);
      if (status.operation.isCompleted) {
        return;
      }
      await sleep(500);
    }
    throw new ClientError(`no result after ${tries} retries`);
  }
}


export class LedgerAPIClient {

  public readonly tokens: TokensLedgerAPI;

  public readonly escrow: EscrowLedgerAPI;

  public readonly payments: PaymentsLedgerAPI;

  public readonly common: CommonLedgerAPI;

  constructor(host: string) {
    this.tokens = new TokensLedgerAPI(host);
    this.escrow = new EscrowLedgerAPI(host);
    this.payments = new PaymentsLedgerAPI(host);
    this.common = new CommonLedgerAPI(host);
  }

  async expectReceipt(status: any): Promise<LedgerAPI['schemas']['receipt']> {
    if (status.isCompleted) {
      return status.response;
    } else {
      return this.common.waitForReceipt(status.cid);
    }
  }

  async expectBalance(owner: LedgerAPI['schemas']['source'], asset: LedgerAPI['schemas']['asset'], amount: number) {
    const balance = await this.common.getBalance({ asset: asset, owner: owner });
    expect(parseInt(balance.balance)).toBe(amount);
  }

}

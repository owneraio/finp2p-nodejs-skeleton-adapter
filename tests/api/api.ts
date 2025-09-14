import {ClientBase} from "./base";
import {components} from '../../src/lib/routes/model-gen';

export class APIClient {

  public readonly tokens: TokensAPI;
  public readonly escrow: EscrowAPI;
  public readonly payments: PaymentsAPI;
  public readonly common: CommonAPI;

  constructor(host: string) {
    this.tokens = new TokensAPI(host);
    this.escrow = new EscrowAPI(host);
    this.payments = new PaymentsAPI(host);
    this.common = new CommonAPI(host);
  }

  async expectReceipt(status: any): Promise<components["schemas"]["receipt"]> {
    if (status.isCompleted) {
      return status.response;
    } else {
      return await this.common.waitForReceipt(status.cid);
    }
  };

  async expectBalance(owner: components["schemas"]["source"], asset: components["schemas"]["asset"], amount: number) {
    const balance = await this.common.getBalance({asset: asset, owner: owner});
    expect(parseInt(balance.balance)).toBe(amount);
  };

}

export class TokensAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async createAsset(req: components["schemas"]["CreateAssetRequest"]): Promise<components["schemas"]["CreateAssetResponse"]> {
    return await this.post("/assets/create", req);
  }

  public async issue(req: components["schemas"]["IssueAssetsRequest"]): Promise<components["schemas"]["IssueAssetsResponse"]> {
    return await this.post("/assets/issue", req);
  }

  public async redeem(req: components["schemas"]["RedeemAssetsRequest"]): Promise<components["schemas"]["RedeemAssetsResponse"]> {
    return await this.post("/assets/redeem", req);
  }

  public async transfer(req: components["schemas"]["TransferAssetRequest"]): Promise<components["schemas"]["TransferAssetResponse"]> {
    return await this.post("/assets/transfer", req);
  }

}

export class EscrowAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async hold(req: components["schemas"]["HoldOperationRequest"]): Promise<components["schemas"]["HoldOperationResponse"]> {
    return await this.post("/assets/hold", req);
  }

  public async release(req: components["schemas"]["ReleaseOperationRequest"]): Promise<components["schemas"]["ReleaseOperationResponse"]> {
    return await this.post("/assets/release", req);
  }

  public async rollback(req: components["schemas"]["RollbackOperationRequest"]): Promise<components["schemas"]["RollbackOperationResponse"]> {
    return await this.post("/assets/rollback", req);
  }
}

export class PaymentsAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async getDepositInstruction(req: components["schemas"]["DepositInstructionRequest"]): Promise<components["schemas"]["DepositInstructionResponse"]> {
    return await this.post("/payments/depositInstruction", req);
  }

  public async payout(req: components["schemas"]["PayoutRequest"]): Promise<components["schemas"]["PayoutResponse"]> {
    return await this.post("/payments/payout", req);
  }
}


export class CommonAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async getReceipt(id: string): Promise<components["schemas"]["GetReceiptResponse"]> {
    return await this.post(`/assets/receipt/${id}`);
  }

  public async getOperationStatus(id: string): Promise<components["schemas"]["GetOperationStatusResponse"]> {
    return await this.get(`/operations/status/${id}`);
  }

  public async getBalance(req: components["schemas"]["GetAssetBalanceRequest"]): Promise<components["schemas"]["GetAssetBalanceResponse"]> {
    return await this.post("/assets/getBalance", req);
  }


  public async waitForReceipt(id: string, tries: number = 30): Promise<components["schemas"]["receipt"]> {
    for (let i = 1; i < tries; i++) {
      const status = await this.getOperationStatus(id);
      if (status.type === "receipt") {
        if (status.operation.isCompleted) {
          return (status.operation).response!;
        }
      } else {
        throw new Error(`wrong status type, deposit expected, got: ${status.type}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no result after ${tries} retries`);
  }

  public async waitForCompletion(id: string, tries: number = 3000) {
    for (let i = 1; i < tries; i++) {
      const status = await this.getOperationStatus(id);
      if (status.operation.isCompleted) {
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no result after ${tries} retries`);
  }
}


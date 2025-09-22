// TODO: that is an PoC interface for plan approval


import {OperationStatus} from "../services";

export interface AssetCreationPlugin {
  validateAssetCreation(assetId: string, tokenId: string): Promise<void>
}

export interface PlanApprovalPlugin {

  validateIssuance(toFinId: string, assetId: string, amount: number): Promise<void>;

  validateTransfer(fromFinId: string, toFinId: string, assetId: string, amount: number): Promise<void>;

  validateRedemption(fromFinId: string, assetId: string, amount: number): Promise<void>;
}

export interface DepositPlugin {
  depositCustomAsync(idempotencyKey: string, cid: string, ownerFinId: string, amount: string, details: any): Promise<void>;
}

export interface LedgerCallbackService {
  sendOperationResult(cid: string, operation: OperationStatus): Promise<void>
}


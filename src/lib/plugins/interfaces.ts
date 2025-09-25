// TODO: that is an PoC interface for plan approval


import {OperationStatus} from "../services";

export interface AssetCreationPlugin {
  validateAssetCreation(idempotencyKey: string, cid: string, assetId: string, tokenId: string): Promise<void>
}

export interface PlanApprovalPlugin {

  validateIssuance(idempotencyKey: string, cid: string, toFinId: string, assetId: string, amount: string): Promise<void>;

  validateTransfer(idempotencyKey: string, cid: string, fromFinId: string, toFinId: string, assetId: string, amount: string): Promise<void>;

  validateRedemption(idempotencyKey: string, cid: string, fromFinId: string, assetId: string, amount: string): Promise<void>;
}

export interface DepositPlugin {
  depositCustomAsync(idempotencyKey: string, cid: string, ownerFinId: string, amount: string, details: any): Promise<void>;
}

export interface LedgerCallbackService {
  sendOperationResult(cid: string, operation: OperationStatus): Promise<void>
}


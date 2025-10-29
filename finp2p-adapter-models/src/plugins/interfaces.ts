
import {
  Asset, DepositAsset,
  DepositOperation, Destination,
  DestinationAccount, ExecutionContext,
  FinIdAccount,
  OperationStatus, PlanApprovalStatus, ReceiptOperation, Signature, Source,
} from '../model';


export interface AssetCreationPlugin {
  validateAssetCreation(assetId: string, tokenId: string): Promise<void>
}

export interface AsyncAssetCreationPlugin {
  validateAssetCreation(idempotencyKey: string, cid: string, assetId: string, tokenId: string): Promise<void>
}

//------------------------------------------------------------


export interface PlanApprovalPlugin {
  validateIssuance(destination: FinIdAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateTransfer(source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateRedemption(source: FinIdAccount, destination: DestinationAccount | undefined, asset: Asset, amount: string): Promise<PlanApprovalStatus>;
}

export interface AsyncPlanApprovalPlugin {

  validateIssuance(idempotencyKey: string, cid: string, destination: FinIdAccount, asset: Asset, amount: string): Promise<void>;

  validateTransfer(idempotencyKey: string, cid: string, source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<void>;

  validateRedemption(idempotencyKey: string, cid: string, source: FinIdAccount, destination: DestinationAccount | undefined, asset: Asset, amount: string): Promise<void>;
}

//------------------------------------------------------------


export interface PaymentsPlugin {

  deposit(owner: FinIdAccount, asset: DepositAsset, amount: string | undefined): Promise<DepositOperation>;

  depositCustom(owner: FinIdAccount, amount: string | undefined, details: any): Promise<DepositOperation>;

  payout(source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<ReceiptOperation>;
}


export interface AsyncPaymentsPlugin {

  deposit(idempotencyKey: string, cid: string, owner: FinIdAccount, asset: DepositAsset, amount: string | undefined): Promise<void>;

  depositCustom(idempotencyKey: string, cid: string, owner: FinIdAccount, amount: string | undefined, details: any): Promise<void>;

  payout(idempotencyKey: string, cid: string, source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<void>;
}

//------------------------------------------------------------


export type TransactionType = 'issue' | 'transfer' | 'redeem' | 'hold' | 'release' | 'rollback';

export interface TransactionHook {

  preTransaction(idempotencyKey: string, type: TransactionType, source: Source | undefined, destination: Destination | undefined, asset: Asset, amount: string, sgn: Signature | undefined, exCtx: ExecutionContext | undefined): Promise<void>;

  postTransaction(idempotencyKey: string, type: TransactionType, source: Source | undefined, destination: Destination | undefined, asset: Asset, amount: string, sgn: Signature | undefined, exCtx: ExecutionContext | undefined, status: OperationStatus): Promise<void>;

}

//------------------------------------------------------------

export interface LedgerCallbackService {
  sendOperationResult(cid: string, operation: OperationStatus): Promise<void>
}


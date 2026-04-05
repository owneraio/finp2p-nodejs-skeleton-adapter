
import {
  Account, Asset, DepositAsset,
  DepositOperation, Destination,
  DestinationAccount, ExecutionContext, ExecutionPlan,
  FinIdAccount,
  OperationStatus, PlanApprovalStatus, ReceiptOperation, Signature, Source,
} from '../model';


export interface AssetCreationPlugin {
  validateAssetCreation(assetId: string, tokenId: string): Promise<void>
}

//------------------------------------------------------------


export interface PlanApprovalPlugin {
  validateIssuance(destination: FinIdAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateTransfer(source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateRedemption(source: FinIdAccount, destination: DestinationAccount | undefined, asset: Asset, amount: string): Promise<PlanApprovalStatus>;
}

//------------------------------------------------------------


export interface PaymentsPlugin {

  deposit(owner: FinIdAccount, asset: DepositAsset, amount: string | undefined): Promise<DepositOperation>;

  depositCustom(owner: FinIdAccount, amount: string | undefined, details: any): Promise<DepositOperation>;

  payout(source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<ReceiptOperation>;
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

//------------------------------------------------------------

export type InstructionResult =
  | { type: 'receipt'; transactionId: string }
  | { type: 'error'; code: number; message: string };

export interface PlannedInboundTransferContext {
  planId: string;
  source: Account;
  asset: Asset;
  destination: Account;
  amount: string;
}

export interface InboundTransferContext extends PlannedInboundTransferContext {
  instructionSequence: number;
  result: InstructionResult;
}

export interface InboundTransferHook {
  onPlannedInboundTransfer(idempotencyKey: string, ctx: PlannedInboundTransferContext): Promise<void>;
  onInboundTransfer(idempotencyKey: string, ctx: InboundTransferContext): Promise<void>;
}

/**
 * Adapter-provided hook to analyze an ExecutionPlan during approval.
 * The returned metadata is stored in DB and injected into ExecutionContext
 * when individual operations execute.
 */
export interface PlanAnalyzer {
  analyzePlan(plan: ExecutionPlan): Promise<Record<string, any>>;
}

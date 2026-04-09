
import {
  Account, Asset, DepositAsset,
  DepositOperation,
  DestinationAccount, ExecutionPlan,
  FinIdAccount,
  OperationStatus, PlanApprovalStatus, ReceiptOperation, Signature,
} from '../model';


export interface AssetCreationPlugin {
  validateAssetCreation(assetId: string, tokenId: string): Promise<void>
}

//------------------------------------------------------------


export type PlanFailureReason = {
  instructionSequence: number;
  code: number;
  message: string;
};

export interface PlanApprovalPlugin {
  validateIssuance(destination: FinIdAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateTransfer(source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateRedemption(source: FinIdAccount, destination: DestinationAccount | undefined, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  onPlanCompleted(planId: string): Promise<void>;

  onPlanFailed(planId: string, status: string, reason: PlanFailureReason | undefined): Promise<void>;
}

//------------------------------------------------------------


export interface PaymentsPlugin {

  deposit(idempotencyKey: string, owner: FinIdAccount, asset: DepositAsset, amount: string | undefined, signature: Signature | undefined): Promise<DepositOperation>;

  depositCustom(idempotencyKey: string, owner: FinIdAccount, amount: string | undefined, details: any, signature: Signature | undefined): Promise<DepositOperation>;

  payout(idempotencyKey: string, source: FinIdAccount, destination: DestinationAccount, asset: Asset, amount: string, signature: Signature | undefined): Promise<ReceiptOperation>;
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

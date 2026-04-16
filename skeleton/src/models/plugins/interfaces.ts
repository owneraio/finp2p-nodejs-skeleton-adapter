
import {
  Account, Asset, DepositAsset,
  DepositOperation,
  DestinationAccount, ExecutionPlan, IntentType, PlanContract,
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

  validateTransfer(source: FinIdAccount, destination: DestinationAccount, sourceAsset: Asset, destinationAsset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateRedemption(source: FinIdAccount, destination: DestinationAccount | undefined, sourceAsset: Asset, destinationAsset: Asset | undefined, amount: string): Promise<PlanApprovalStatus>;

  onPlanCompleted(planId: string, intentType: IntentType | undefined, contract: PlanContract): Promise<void>;

  onPlanFailed(planId: string, intentType: IntentType | undefined, contract: PlanContract, status: string, reason: PlanFailureReason | undefined): Promise<void>;
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
  sourceAccount: Account;
  sourceAsset: Asset;
  destinationAccount: Account;
  destinationAsset: Asset;
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

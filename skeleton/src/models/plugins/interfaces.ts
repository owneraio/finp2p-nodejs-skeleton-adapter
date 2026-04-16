
import {
  Asset, DepositAsset,
  DepositOperation,
  ExecutionPlan, IntentType, PlanContract,
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
  validateIssuance(destinationFinId: string, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateTransfer(sourceFinId: string, destinationFinId: string, asset: Asset, amount: string): Promise<PlanApprovalStatus>;

  validateRedemption(sourceFinId: string, destinationFinId: string | undefined, sourceAsset: Asset, destinationAsset: Asset | undefined, amount: string): Promise<PlanApprovalStatus>;

  onPlanCompleted(planId: string, intentType: IntentType | undefined, contract: PlanContract): Promise<void>;

  onPlanFailed(planId: string, intentType: IntentType | undefined, contract: PlanContract, status: string, reason: PlanFailureReason | undefined): Promise<void>;
}

//------------------------------------------------------------


export interface PaymentsPlugin {

  deposit(idempotencyKey: string, ownerFinId: string, asset: DepositAsset, amount: string | undefined, signature: Signature | undefined): Promise<DepositOperation>;

  depositCustom(idempotencyKey: string, ownerFinId: string, amount: string | undefined, details: any, signature: Signature | undefined): Promise<DepositOperation>;

  payout(idempotencyKey: string, sourceFinId: string, destinationFinId: string, asset: Asset, amount: string, signature: Signature | undefined): Promise<ReceiptOperation>;
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
  sourceFinId: string;
  asset: Asset;
  destinationFinId: string;
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

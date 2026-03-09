import {
  Asset,
  AssetCreationStatus,
  Destination,
  ExecutionContext,
  Signature,
  Source,
  ReceiptOperation, Balance, OperationStatus, PlanApprovalStatus, PlanProposal, DepositOperation, DepositAsset,
  FinIdAccount, AssetBind, AssetDenomination, AssetIdentifier, LedgerReference, Receipt,
} from './model';


export interface HealthService {
  liveness(): Promise<void>

  readiness(): Promise<void>
}

export interface CommonService {

  getReceipt(id: string): Promise<ReceiptOperation>

  operationStatus(cid: string): Promise<OperationStatus>
}

export interface TokenService {

  createAsset(idempotencyKey: string, asset: Asset,
    assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined): Promise<AssetCreationStatus>;

  getBalance(asset: Asset, finId: string): Promise<string>;

  balance(asset: Asset, finId: string): Promise<Balance>;

  issue(idempotencyKey: string, asset: Asset, to: FinIdAccount, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation>;

  transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, asset: Asset,
    quantity: string, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation>;

  redeem(idempotencyKey: string, nonce: string, source: FinIdAccount, asset: Asset, quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation>

}

export interface EscrowService {

  hold(idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined, asset: Asset,
    quantity: string, signature: Signature, operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation>

  release(idempotencyKey: string, source: Source, destination: Destination, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation>

  rollback(idempotencyKey: string, source: Source, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation>

}

export interface PaymentService {
  getDepositInstruction(idempotencyKey: string, owner: Source, destination: Destination, asset: DepositAsset, amount: string | undefined,
    details: any | undefined,
    nonce: string | undefined, signature: Signature | undefined): Promise<DepositOperation>

  payout(idempotencyKey: string, source: Source, destination: Destination | undefined, asset: Asset, quantity: string,
    description: string | undefined, nonce: string | undefined,
    signature: Signature | undefined): Promise<ReceiptOperation>

}

export interface PlanApprovalService {
  approvePlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus>

  proposeCancelPlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus>

  proposeResetPlan(idempotencyKey: string, planId: string, proposedSequence: number): Promise<PlanApprovalStatus>

  proposeInstructionApproval(idempotencyKey: string, planId: string, instructionSequence: number): Promise<PlanApprovalStatus>

  proposalStatus(planId: string, proposal: PlanProposal, status: 'approved' | 'rejected'): Promise<void>
}

/**
 * Delegate interface for omnibus ledger operations that require
 * external/on-chain interaction. Adapter developers implement this
 * when opting into the omnibus DB ledger.
 */
export interface OmnibusDelegate {
  /**
   * Called when release/transfer targets an external destination (crypto/IBAN).
   * Internal DB bookkeeping (unlock/debit) is already done.
   */
  executeExternalTransfer(
    idempotencyKey: string,
    source: Source,
    destination: Destination,
    asset: Asset,
    quantity: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<{ transactionId: string }>;

  /**
   * Optional: called on createAsset for ledger-specific setup (e.g. deploy smart contract).
   */
  onAssetCreated?(
    idempotencyKey: string,
    asset: Asset,
    assetBind: AssetBind | undefined,
    assetMetadata: any | undefined,
  ): Promise<{ tokenId: string; reference: LedgerReference | undefined }>;

  /**
   * Optional: custom receipt/proof generation.
   * If not provided, the omnibus builds a basic receipt.
   */
  generateReceipt?(
    asset: Asset,
    source: Source | undefined,
    destination: Destination | undefined,
    quantity: string,
    operationType: string,
    transactionId: string,
    exCtx: ExecutionContext | undefined,
    operationId: string | undefined,
  ): Promise<Receipt>;
}

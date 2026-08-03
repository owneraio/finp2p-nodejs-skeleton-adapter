import {
  Asset,
  AssetCreationStatus,
  Destination,
  ExecutionContext,
  Signature,
  Source,
  ReceiptOperation, Balance, OperationStatus, PlanApprovalStatus, PlanProposal, DepositOperation, DepositAsset,
  AssetBind, AssetDenomination, AccountMapping,
  AccountOperation, BindInfo, NetworkAccount,
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

  createAsset(idempotencyKey: string, assetId: string,
    assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus>;

  getBalance(asset: Asset, finId: string): Promise<string>;

  balance(asset: Asset, finId: string): Promise<Balance>;

  issue(idempotencyKey: string, asset: Asset, destination: Destination, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation>;

  transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, asset: Asset,
    quantity: string, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation>;

  redeem(idempotencyKey: string, nonce: string, source: Source, asset: Asset, quantity: string, operationId: string | undefined,
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

export interface AccountMappingService {
  getAccounts(finIds?: string[]): Promise<AccountMapping[]>

  getByFieldValue(fieldName: string, value: string): Promise<AccountMapping[]>

  saveAccount(finId: string, fields: Record<string, string>): Promise<AccountMapping>

  deleteAccount(finId: string, fieldName?: string): Promise<void>
}

/**
 * Investor network-account onboarding (bind / unbind), sync trust model: the
 * caller-supplied wallet is recorded without an ownership challenge — the same
 * trust the old finId->wallet mapping API extended.
 *
 * Replaces the finId->wallet mapping API. The request carries the investor's
 * finId, letting the adapter couple the binding to the investor and enforce
 * wallet<->finId ownership on later operations; the wallet also still arrives
 * per operation on the instruction leg (`Source.account` / `Destination.account`).
 * The same address may be bound many times (omnibus: one shared wallet, many
 * investors); only a re-sent request (same idempotency key) replays.
 *
 * Both methods are single-call and terminal, so implementations may be wrapped
 * in the workflow `createServiceProxy` like any other service.
 */
export interface NetworkAccountService {

  /**
   * Bind a caller-supplied investor account (bindInfo absent = create-new mode).
   *
   * `finId` identifies the investor being onboarded. It should NOT be optional:
   * the router marks it optional in the OAS "for backward compatibility" even
   * though the feature is brand new — treat absence as a legacy-router quirk,
   * not a supported mode.
   */
  createAccount(idempotencyKey: string, organizationId: string, assetId: string,
    finId: string | undefined, bindInfo: BindInfo | undefined): Promise<AccountOperation>

  /** Unbind a previously bound account by its LA-assigned id. */
  removeAccount(idempotencyKey: string, accountId: string): Promise<AccountOperation>
}

/**
 * Optional pre-bind validator for network accounts (e.g. ledger address shape).
 * Throw AccountInvalidShapeError to reject the binding.
 */
export interface NetworkAccountValidator {
  validate(account: NetworkAccount): Promise<void>
}

/**
 * Optional pre-save validator for account mappings.
 * Adapters can implement this to validate and optionally transform fields before persistence.
 * Throw ValidationError to reject the mapping.
 */
export interface AccountMappingValidator {
  validate(finId: string, fields: Record<string, string>): Promise<Record<string, string>>
}

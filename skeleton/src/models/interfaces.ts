import {
  Asset,
  AssetCreationStatus,
  Destination,
  ExecutionContext,
  Signature,
  Source,
  ReceiptOperation, Balance, OperationStatus, PlanApprovalStatus, PlanProposal, DepositOperation, DepositAsset,
  AssetBind, AssetDenomination, AccountMapping, InvestorWhitelistEntry, WhitelistParty,
  AccountOperation, AccountProof, BindInfo, IssuedAccountChallenge, NetworkAccount,
  SwapLeg, SwapOperation,
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
    assetBind: AssetBind, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus>;

  getBalance(asset: Asset, finId: string): Promise<string>;

  balance(asset: Asset, finId: string): Promise<Balance>;

  issue(idempotencyKey: string, asset: Asset, destination: Destination, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation>;

  transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, asset: Asset,
    quantity: string, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation>;

  redeem(idempotencyKey: string, nonce: string, source: Source, asset: Asset, quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation>

  /**
   * Moves a holding from one asset binding to another: a conversion, not a trade, so
   * there is no counterparty leg and no settlement leg. `asset` is the source binding
   * and `destinationAsset` the destination binding; a move normally crosses assets, so
   * the two differ (unlike {@link transfer}, where one binding serves both).
   *
   * **Optional.** An adapter whose ledger has no conversion leaves it out and keeps
   * compiling; `POST /assets/move` then answers a failed receipt saying move is not
   * supported, rather than 404. Implementing it is what turns the route on.
   *
   * Refuse a move whose two assets this adapter does not both hold: only the adapter
   * knows its own bindings, so the skeleton cannot make that call for it. Do not infer
   * it from the assets' organizations, which refuses valid moves on an adapter serving
   * several, nor from `source.finId` against `destination.finId`, since one investor
   * can hold several keys. Receipts carry `operationType: 'move'`.
   */
  move?(idempotencyKey: string, nonce: string, source: Source, destination: Destination, asset: Asset,
    destinationAsset: Asset, quantity: string, signature: Signature, operationId: string | undefined,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation>

  /**
   * Atomic same-ledger swap. `asset` is the leg this adapter executes, `settlement` the counter-leg.
   * `numberOfReceipts`: 1 = cross-org (counterparty executes `settlement`), 2 = both legs here.
   * `deadline` is absolute epoch seconds.
   */
  swap(idempotencyKey: string, nonce: string, operationId: string, asset: SwapLeg, settlement: SwapLeg,
    numberOfReceipts: number, deadline: number, exCtx: ExecutionContext | undefined
  ): Promise<SwapOperation>

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
 * Investor whitelisting, adapter-internal — the router never calls these. The
 * skeleton defines no semantics and no storage; an implementation delegating to
 * on-ledger enforcement may not be able to report the submitted config back from
 * getWhitelist. Throw {@link WhitelistRefusedError} for a policy refusal.
 */
export interface InvestorWhitelistService {
  whitelist(party: WhitelistParty, assetId: string, config: Record<string, unknown>): Promise<InvestorWhitelistEntry>

  /** Omit assetId to dewhitelist the party for every asset. Returns the number
   *  of entries removed; removing nothing is not an error. */
  dewhitelist(party: WhitelistParty, assetId?: string): Promise<number>

  getWhitelist(party?: WhitelistParty, assetId?: string): Promise<InvestorWhitelistEntry[]>

  isWhitelisted(party: WhitelistParty, assetId: string): Promise<boolean>
}

/** Optional pre-write hook for implementations. Throw ValidationError to reject;
 *  the returned config is what the implementation should persist. */
export interface InvestorWhitelistValidator {
  validate(party: WhitelistParty, assetId: string, config: Record<string, unknown>): Promise<Record<string, unknown>>
}

export interface AccountMappingService {
  getAccounts(finIds?: string[]): Promise<AccountMapping[]>

  getByFieldValue(fieldName: string, value: string): Promise<AccountMapping[]>

  saveAccount(finId: string, fields: Record<string, string>): Promise<AccountMapping>

  deleteAccount(finId: string, fieldName?: string): Promise<void>
}

/**
 * Investor network-account onboarding (bind / unbind).
 *
 * Replaces the finId->wallet mapping API. The request carries the investor's
 * finId, letting the adapter couple the binding to the investor and enforce
 * wallet<->finId ownership on later operations; the wallet also still arrives
 * per operation on the instruction leg (`Source.account` / `Destination.account`).
 * The same address may be bound many times (omnibus: one shared wallet, many
 * investors), but one investor holds at most one binding per (org, asset):
 * a repeat create for the same finId replays the recorded binding.
 *
 * createAccount either settles at once (the sync trust model of
 * NetworkAccountServiceImpl: the caller-supplied wallet is recorded without a
 * challenge) or answers with a challenge (`challengedAccountOperation`) the
 * investor must fulfill first; the create then finishes in
 * `completeAccountChallenge` when the router posts the proof. Challenges need the
 * workflow `createServiceProxy` over `createAccount`: it keeps the challenged
 * create under its cid and answers `POST /accounts/{cid}/proof`. Without
 * challenges both required methods are single-call and terminal, so
 * implementations may be wrapped in the proxy like any other service.
 */
export interface NetworkAccountService {

  /**
   * Bind a caller-supplied investor account (bindInfo absent = create-new mode).
   * `finId` identifies the investor being onboarded. Return a challenge when the
   * investor must act before the binding holds.
   */
  createAccount(idempotencyKey: string, organizationId: string, assetId: string,
    finId: string, bindInfo: BindInfo | undefined): Promise<AccountOperation>

  /** Unbind a previously bound account by its LA-assigned id. */
  removeAccount(idempotencyKey: string, accountId: string): Promise<AccountOperation>

  /**
   * Finish a create that answered with a challenge, once a proof for it arrives.
   * `issued` is that create as the workflow proxy kept it: its request, the
   * challenge and its cid. `idempotencyKey` is the proof's own, fresh on every
   * call: never dedupe on it.
   *
   * Called by the workflow proxy only, one proof at a time per create. It may run
   * again for the same create (a proof after a refusal, a restart mid-proof), so it
   * must be idempotent.
   *
   * The proxy keeps `issued.expiresAt` but never acts on it: a proof that arrives
   * after it is passed on like any other. To end an expired challenge, return
   * `failedAccountOperation('', AccountErrorCodes.challengeTimeout, ...)`; later
   * proofs for that create then answer 410.
   *
   * - Return success or failure to settle the onboarding; a pending or challenge
   *   result is treated as an error.
   * - Throw AccountProofRefusedError when the proof does not fulfill the challenge:
   *   the router gets 401 (7345 unless the error carries another code) and the
   *   challenge stays open. Any other throw, whatever its class, also leaves it open
   *   and answers 500. Only a returned failure ends the onboarding, so catch a
   *   NetworkAccountValidator refusal from recordAccount (AccountInvalidShapeError)
   *   and return a failure when it should end it.
   *
   * Implementing it opts the service into challenges: under the proxy, createAccount
   * then runs inside the create request, so it must answer well within the router's
   * request timeout, with a result or a challenge (a pending result fails the create).
   */
  completeAccountChallenge?(idempotencyKey: string, issued: IssuedAccountChallenge, proof: AccountProof): Promise<AccountOperation>

  /**
   * `POST /accounts/{cid}/proof`, by the create's cid. The workflow proxy over
   * createAccount provides it for a service that implements completeAccountChallenge;
   * implement it only without the proxy, for a challenge whose cid the service
   * minted. Absent: the route answers 501.
   */
  submitAccountProof?(idempotencyKey: string, cid: string, proof: AccountProof): Promise<AccountOperation>
}

/**
 * Optional pre-bind validator for network accounts (e.g. ledger address shape).
 * Throw AccountInvalidShapeError to reject the binding — this is where an
 * adapter refuses a variant its ledger cannot service.
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

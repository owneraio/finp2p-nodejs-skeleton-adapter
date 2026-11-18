
import {
  AccountChallenge,
  Asset, DepositAsset,
  DepositOperation,
  ExecutionPlan, IntentType, NetworkAccount, PlanContract,
  OperationStatus, PlanApprovalStatus, ReceiptOperation, Signature,
} from '../model';
import { Logger } from '../logger';

/**
 * Optional startup hook. `PluginManager.init()` calls this once on every
 * registered plugin that has it, and the adapter awaits that call before it
 * starts listening.
 *
 * A plugin that needs a session (a service-account login, for instance) opens
 * it here and owns everything after: token refresh, re-authentication, and the
 * retry on a 401. The skeleton never calls `init` a second time.
 *
 * A throw stops startup, so throw only for what will not come right on its own:
 * credentials the remote side rejects, or configuration that cannot be read.
 * A transient problem is the plugin's to absorb — log it, start anyway, and
 * authenticate lazily on first use — so that an outage in one dependency does
 * not take down flows that never touch it.
 */
export interface PluginLifecycle {
  init(logger: Logger): Promise<void>;
}

//------------------------------------------------------------

/**
 * The outcome of claiming an investor's account with whatever authority owns
 * the link between a wallet and a legal entity.
 */
export type AccountClaimResult =
  /** The account is linked and the binding may be recorded. Also the right
   *  answer for an account that was already linked, which is what makes a
   *  repeat create replay cleanly. */
  | { type: 'linked' }
  /** The claim was rejected and nothing is recorded. `code` and `message` are
   *  what the node sees; put the machine-readable kind in `reason` for your own
   *  dispatch and logs, and repeat it in `message` so it survives the wire. */
  | { type: 'refused'; code: number; message: string; reason?: string }
  /** The claim is under way and the answer will take time.
   *  **Not honoured until phase 2**: the skeleton fails the operation today. */
  | { type: 'pending'; expiresInSeconds?: number; message?: string }
  /** The investor must fulfil a challenge before the account can be linked.
   *  **Not honoured until phase 2**: the skeleton fails the operation today. */
  | { type: 'challenge'; challenge: AccountChallenge; expiresInSeconds?: number };

/**
 * Optional hook that links an investor's account to its legal entity with an
 * external authority before the skeleton records the binding.
 *
 * `NetworkAccountValidator` asks whether the skeleton can service an account at
 * all, which is local and about shape. This asks whether the account is the
 * investor's to use, which is remote and about identity. The validator runs
 * first, so a malformed address never costs a remote round trip.
 *
 * Register one implementation; dispatch by ledger inside it if the adapter
 * serves more than one.
 */
export interface AccountClaimPlugin {

  /**
   * Called once per `createAccount`, after validation and before the binding is
   * stored, including when the create is a repeat for an account already bound.
   * Implementations must therefore be idempotent, and must answer `linked` for
   * an account that is already linked.
   *
   * A `refused` on a repeat create fails the operation and leaves the stored
   * binding alone. The skeleton never deletes a binding on the strength of a
   * refusal; unbinding is `DELETE /accounts/{accountId}` and nothing else.
   */
  claim(organizationId: string, assetId: string, finId: string, account: NetworkAccount): Promise<AccountClaimResult>;

  /**
   * Verify a signature over a `signatureTemplate` challenge
   * (`POST /accounts/{cid}/proof`).
   *
   * Declared now so the shape is settled, but **phase 2**: the skeleton does
   * not route that endpoint here yet.
   */
  prove?(correlationId: string, signature: string): Promise<AccountClaimResult>;
}

//------------------------------------------------------------


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

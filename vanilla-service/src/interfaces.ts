import {
  Asset, AssetBind, AssetCreationResult, AssetDenomination, AssetIdentifier, AssetType,
  Destination, ExecutionContext, Source,
} from '@owneraio/finp2p-adapter-models';

/**
 * Result of a delegate operation. Must be either success or failure —
 * pending/async results are not supported; the delegate must complete
 * the operation synchronously before returning.
 */
export type DelegateResult =
  | { success: true; transactionId: string }
  | { success: false; error: string };

/**
 * Optional delegate for asset creation.
 * When provided, createAsset calls the delegate instead of generating a local tokenId.
 */
export interface AssetDelegate {
  createAsset(
    idempotencyKey: string,
    asset: Asset,
    assetBind: AssetBind | undefined,
    assetMetadata: any | undefined,
    assetName: string | undefined,
    issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined,
    assetIdentifier: AssetIdentifier | undefined,
  ): Promise<AssetCreationResult>;
}

/**
 * Thrown by TransferDelegate.onInboundTransfer when the on-chain transfer
 * cannot be verified. The vanilla service catches this and skips the credit.
 */
export class InboundTransferVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InboundTransferVerificationError';
  }
}

/**
 * Delegate for external transfer operations (on-chain transfers, IBAN payouts).
 *
 * The vanilla service wraps each call with local DB safeguards:
 * 1. Lock funds in the local ledger
 * 2. Call outboundTransfer
 * 3. On success → unlock and debit locally
 * 4. On failure → unlock locally (funds return to available)
 */
export interface TransferDelegate {
  outboundTransfer(
    idempotencyKey: string,
    source: Source,
    destination: Destination,
    asset: Asset,
    quantity: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult>;

  /**
   * Called before crediting a destination account for an inbound transfer.
   * The delegate should verify that the transfer actually happened on-chain.
   * Throw InboundTransferVerificationError if the transfer cannot be verified.
   */
  onInboundTransfer?(
    transactionId: string,
    source: Source,
    asset: Asset,
    destination: Destination,
    amount: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<void>;
}

/**
 * Optional delegate for external escrow operations.
 * When provided, the escrow service calls hold/release on the delegate
 * in addition to local DB lock/unlock.
 *
 * hold: called after local lock. On failure → local unlock.
 * release: called before local unlockAndMove. On failure → funds stay held.
 * rollback: called before local unlock. On failure → funds stay held.
 */
export interface EscrowDelegate {
  hold(
    idempotencyKey: string,
    source: Source,
    destination: Destination | undefined,
    asset: Asset,
    quantity: string,
    operationId: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult>;

  release(
    idempotencyKey: string,
    source: Source,
    destination: Destination,
    asset: Asset,
    quantity: string,
    operationId: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult>;

  rollback(
    idempotencyKey: string,
    source: Source,
    asset: Asset,
    quantity: string,
    operationId: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult>;
}

/**
 * Delegate for querying the omnibus wallet balance on-chain.
 * The adapter must implement this to enable distribution tracking.
 */
export interface OmnibusDelegate {
  getOmnibusBalance(assetId: string, assetType: AssetType): Promise<string>;
}

export type DistributionStatus = {
  assetId: string;
  assetType: AssetType;
  omnibusBalance: string;
  distributedBalance: string;
  availableBalance: string;
};

export interface DistributionService {
  syncOmnibus(assetId: string, assetType: AssetType): Promise<DistributionStatus>;
  getDistributionStatus(assetId: string, assetType: AssetType): Promise<DistributionStatus>;
  distribute(finId: string, assetId: string, assetType: AssetType, amount: string): Promise<void>;
  reclaim(finId: string, assetId: string, assetType: AssetType, amount: string): Promise<void>;
}

import {
  Asset, Destination, ExecutionContext, Source,
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
 * Delegate for external payout operations (on-chain transfers, IBAN payouts).
 *
 * The vanilla service wraps each call with local DB safeguards:
 * 1. Lock funds in the local ledger
 * 2. Call payout
 * 3. On success → unlock and debit locally
 * 4. On failure → unlock locally (funds return to available)
 */
export interface PayoutDelegate {
  payout(
    idempotencyKey: string,
    source: Source,
    destination: Destination,
    asset: Asset,
    quantity: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<DelegateResult>;
}

/**
 * Optional delegate for external escrow operations.
 * When provided, the escrow service calls hold/release on the delegate
 * in addition to local DB lock/unlock.
 *
 * hold: called after local lock. On failure → local unlock.
 * release: called before local unlockAndMove. On failure → funds stay held.
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
}

import { NewPoolTx, PoolTx, TxAttempt } from '../types';

/**
 * Persistence contract for the tx pool. All methods must be safe to call from
 * multiple replicas sharing one database:
 * - allocateAndInsert serializes nonce allocation (counter row under FOR UPDATE)
 * - claim* hand out disjoint row sets via FOR UPDATE SKIP LOCKED + a lease
 */
export interface TxPoolStore {
  /**
   * Atomically allocates the next nonce for (signer, chain) and inserts the tx
   * row with it, in one transaction. `explicitNonce` pins the nonce instead of
   * allocating (still advances the counter past it). `initNonce` is invoked
   * only when no counter row exists yet (first use) — typically
   * `provider.getTransactionCount(addr, 'pending')`.
   */
  allocateAndInsert(tx: NewPoolTx, explicitNonce: number | null, initNonce: () => Promise<number>): Promise<PoolTx>;

  /**
   * Repairs the counter after a nonce conflict:
   * next_nonce = max(chainPendingNonce, highest active row nonce + 1).
   */
  resyncNonce(signerAddress: string, chainId: bigint, chainPendingNonce: number): Promise<void>;

  /** Appends a broadcast attempt: attempts+, attempt_count++, latest_hash, submitted_at=now, status='submitted'. */
  markSubmitted(id: string, attempt: TxAttempt): Promise<void>;
  /** Appends a cancel attempt (0-value self-transfer) and moves the row to 'cancelling'. */
  markCancelling(id: string, attempt: TxAttempt): Promise<void>;
  markConfirmed(id: string, receipt: object): Promise<void>;
  markFailed(id: string, error: string, receipt?: object): Promise<void>;
  markDropped(id: string, reason: string): Promise<void>;
  markCancelled(id: string, receipt: object): Promise<void>;
  /** Records a non-terminal error without changing status. */
  recordError(id: string, error: string): Promise<void>;

  /**
   * Claims up to `limit` rows in 'submitted'/'cancelling' whose lease is absent
   * or expired, extending the lease by `leaseMs`. Concurrent claimers receive
   * disjoint sets (SKIP LOCKED semantics).
   */
  claimActive(signerAddress: string, chainId: bigint, limit: number, leaseMs: number): Promise<PoolTx[]>;

  /**
   * Claims rows stuck in 'pending' (crash between insert and broadcast) older
   * than `olderThanMs`. Same lease semantics as claimActive.
   */
  claimStalePending(signerAddress: string, chainId: bigint, olderThanMs: number, leaseMs: number): Promise<PoolTx[]>;

  /** Clears the lease so other replicas may claim the row immediately. */
  releaseClaim(id: string): Promise<void>;

  /** Looks a row up by any of its attempt hashes (or latest_hash). */
  findByHash(hash: string): Promise<PoolTx | undefined>;

  getById(id: string): Promise<PoolTx | undefined>;
}

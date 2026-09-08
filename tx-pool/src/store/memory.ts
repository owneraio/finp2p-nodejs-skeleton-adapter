import { randomUUID } from 'node:crypto';
import { NewPoolTx, PoolTx, TxAttempt, TxPoolError } from '../types';
import { TxPoolStore } from './store';

const key = (signer: string, chainId: bigint) => `${signer.toLowerCase()}:${chainId}`;

const copy = (row: PoolTx): PoolTx => ({ ...row, attempts: row.attempts.map((a) => ({ ...a })) });

/**
 * Single-process reference implementation, mainly for tests and DB-less dev.
 * Mirrors PgTxPoolStore semantics including lease bookkeeping and the
 * one-live-tx-per-nonce constraint. NOT multi-replica safe.
 */
export class InMemoryTxPoolStore implements TxPoolStore {
  private rows = new Map<string, PoolTx>();

  private nextNonce = new Map<string, number>();

  private tail: Promise<unknown> = Promise.resolve();

  /** Serializes allocation the way the counter-row lock does in Postgres. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }

  async allocateAndInsert(tx: NewPoolTx, explicitNonce: number | null, initNonce: () => Promise<number>): Promise<PoolTx> {
    return this.locked(async () => {
      const k = key(tx.signerAddress, tx.chainId);
      if (!this.nextNonce.has(k)) {
        this.nextNonce.set(k, await initNonce());
      }
      const nonce = explicitNonce ?? this.nextNonce.get(k)!;
      const conflict = [...this.rows.values()].find((r) => key(r.signerAddress, r.chainId) === k
        && r.nonce === nonce && ['pending', 'submitted', 'cancelling'].includes(r.status));
      if (conflict) {
        throw new TxPoolError(`Active tx already exists for nonce ${nonce} (id ${conflict.id})`);
      }
      this.nextNonce.set(k, Math.max(this.nextNonce.get(k)!, nonce + 1));
      const now = new Date();
      const row: PoolTx = {
        id: randomUUID(),
        signerAddress: tx.signerAddress,
        chainId: tx.chainId,
        nonce,
        status: 'pending',
        txRequest: tx.txRequest,
        attempts: [],
        latestHash: null,
        attemptCount: 0,
        claimedUntil: null,
        lastError: null,
        receipt: null,
        createdAt: now,
        updatedAt: now,
        submittedAt: null,
      };
      this.rows.set(row.id, row);
      return copy(row);
    });
  }

  async resyncNonce(signerAddress: string, chainId: bigint, chainPendingNonce: number): Promise<void> {
    return this.locked(async () => {
      const k = key(signerAddress, chainId);
      const maxActive = [...this.rows.values()]
        .filter((r) => key(r.signerAddress, r.chainId) === k && ['pending', 'submitted', 'cancelling'].includes(r.status))
        .reduce((m, r) => Math.max(m, r.nonce), -1);
      this.nextNonce.set(k, Math.max(chainPendingNonce, maxActive + 1));
    });
  }

  private mustGet(id: string): PoolTx {
    const row = this.rows.get(id);
    if (!row) throw new TxPoolError(`No pool tx with id ${id}`);
    return row;
  }

  private appendAttempt(id: string, attempt: TxAttempt, status: 'submitted' | 'cancelling'): void {
    const row = this.mustGet(id);
    row.attempts.push({ ...attempt });
    row.attemptCount += 1;
    row.latestHash = attempt.hash;
    row.status = status;
    row.submittedAt = new Date();
    row.updatedAt = new Date();
  }

  async markSubmitted(id: string, attempt: TxAttempt): Promise<void> {
    this.appendAttempt(id, attempt, 'submitted');
  }

  async markCancelling(id: string, attempt: TxAttempt): Promise<void> {
    this.appendAttempt(id, { ...attempt, cancel: true }, 'cancelling');
  }

  async markConfirmed(id: string, receipt: object): Promise<void> {
    const row = this.mustGet(id);
    row.status = 'confirmed';
    row.receipt = receipt;
    row.claimedUntil = null;
    row.updatedAt = new Date();
  }

  async markFailed(id: string, error: string, receipt?: object): Promise<void> {
    const row = this.mustGet(id);
    row.status = 'failed';
    row.lastError = error;
    if (receipt) row.receipt = receipt;
    row.claimedUntil = null;
    row.updatedAt = new Date();
  }

  async markDropped(id: string, reason: string): Promise<void> {
    const row = this.mustGet(id);
    row.status = 'dropped';
    row.lastError = reason;
    row.claimedUntil = null;
    row.updatedAt = new Date();
  }

  async markCancelled(id: string, receipt: object): Promise<void> {
    const row = this.mustGet(id);
    row.status = 'cancelled';
    row.receipt = receipt;
    row.claimedUntil = null;
    row.updatedAt = new Date();
  }

  async recordError(id: string, error: string): Promise<void> {
    const row = this.mustGet(id);
    row.lastError = error;
    row.updatedAt = new Date();
  }

  private claim(rows: PoolTx[], limit: number, leaseMs: number): PoolTx[] {
    const now = Date.now();
    const claimable = rows
      .filter((r) => r.claimedUntil === null || r.claimedUntil.getTime() < now)
      .sort((a, b) => a.nonce - b.nonce)
      .slice(0, limit);
    for (const r of claimable) {
      r.claimedUntil = new Date(now + leaseMs);
    }
    return claimable.map(copy);
  }

  async claimActive(signerAddress: string, chainId: bigint, limit: number, leaseMs: number): Promise<PoolTx[]> {
    return this.locked(async () => {
      const k = key(signerAddress, chainId);
      const rows = [...this.rows.values()]
        .filter((r) => key(r.signerAddress, r.chainId) === k && (r.status === 'submitted' || r.status === 'cancelling'));
      return this.claim(rows, limit, leaseMs);
    });
  }

  async claimStalePending(signerAddress: string, chainId: bigint, olderThanMs: number, leaseMs: number): Promise<PoolTx[]> {
    return this.locked(async () => {
      const k = key(signerAddress, chainId);
      const cutoff = Date.now() - olderThanMs;
      const rows = [...this.rows.values()]
        .filter((r) => key(r.signerAddress, r.chainId) === k && r.status === 'pending' && r.createdAt.getTime() < cutoff);
      return this.claim(rows, Number.MAX_SAFE_INTEGER, leaseMs);
    });
  }

  async releaseClaim(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.claimedUntil = null;
    }
  }

  async findByHash(hash: string): Promise<PoolTx | undefined> {
    const row = [...this.rows.values()]
      .find((r) => r.latestHash === hash || r.attempts.some((a) => a.hash === hash));
    return row ? copy(row) : undefined;
  }

  async getById(id: string): Promise<PoolTx | undefined> {
    const row = this.rows.get(id);
    return row ? copy(row) : undefined;
  }
}

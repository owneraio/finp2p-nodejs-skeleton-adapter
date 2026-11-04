import { Pool, PoolClient } from 'pg';
import { storage } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { DEFAULT_SCHEMA_NAME } from '../config';
import { NewPoolTx, PoolTx, TxAttempt, TxPoolError, TxStatus } from '../types';
import { TxPoolStore } from './store';

interface PgRow {
  id: string;
  signer_address: string;
  chain_id: string;
  nonce: string;
  status: TxStatus;
  tx_request: PoolTx['txRequest'];
  attempts: TxAttempt[];
  latest_hash: string | null;
  attempt_count: number;
  claimed_until: Date | null;
  last_error: string | null;
  receipt: object | null;
  created_at: Date;
  updated_at: Date;
  submitted_at: Date | null;
}

const fromRow = (r: PgRow): PoolTx => ({
  id: r.id,
  signerAddress: r.signer_address,
  chainId: BigInt(r.chain_id),
  nonce: Number(r.nonce),
  status: r.status,
  txRequest: r.tx_request,
  attempts: r.attempts,
  latestHash: r.latest_hash,
  attemptCount: r.attempt_count,
  claimedUntil: r.claimed_until,
  lastError: r.last_error,
  receipt: r.receipt,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  submittedAt: r.submitted_at,
});

export class PgTxPoolStore implements TxPoolStore {
  private readonly schema: string;

  constructor(private pool: Pool, schemaName: string = DEFAULT_SCHEMA_NAME) {
    storage.assertValidPostgresIdentifier(schemaName);
    this.schema = schemaName;
  }

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async allocateAndInsert(tx: NewPoolTx, explicitNonce: number | null, initNonce: () => Promise<number>): Promise<PoolTx> {
    // Seed the counter row outside the allocation transaction so the (slow)
    // RPC call in initNonce never runs while the counter is locked.
    const existing = await this.pool.query(
      `SELECT 1 FROM ${this.schema}.tx_pool_nonces WHERE signer_address = $1 AND chain_id = $2`,
      [tx.signerAddress, tx.chainId.toString()],
    );
    if (existing.rowCount === 0) {
      const initial = await initNonce();
      await this.pool.query(
        `INSERT INTO ${this.schema}.tx_pool_nonces(signer_address, chain_id, next_nonce)
         VALUES ($1, $2, $3) ON CONFLICT (signer_address, chain_id) DO NOTHING`,
        [tx.signerAddress, tx.chainId.toString(), initial],
      );
    }

    return this.withTransaction(async (client) => {
      const counter = await client.query(
        `SELECT next_nonce FROM ${this.schema}.tx_pool_nonces
         WHERE signer_address = $1 AND chain_id = $2 FOR UPDATE`,
        [tx.signerAddress, tx.chainId.toString()],
      );
      if (counter.rowCount === 0) {
        throw new TxPoolError(`Nonce counter row disappeared for ${tx.signerAddress}/${tx.chainId}`);
      }
      const nonce = explicitNonce ?? Number(counter.rows[0].next_nonce);

      let inserted;
      try {
        inserted = await client.query(
          `INSERT INTO ${this.schema}.tx_pool_transactions(signer_address, chain_id, nonce, tx_request)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [tx.signerAddress, tx.chainId.toString(), nonce, JSON.stringify(tx.txRequest)],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          throw new TxPoolError(`Active tx already exists for nonce ${nonce} of ${tx.signerAddress}/${tx.chainId}`, e);
        }
        throw e;
      }

      await client.query(
        `UPDATE ${this.schema}.tx_pool_nonces SET next_nonce = GREATEST(next_nonce, $3)
         WHERE signer_address = $1 AND chain_id = $2`,
        [tx.signerAddress, tx.chainId.toString(), nonce + 1],
      );
      return fromRow(inserted.rows[0]);
    });
  }

  async resyncNonce(signerAddress: string, chainId: bigint, chainPendingNonce: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.tx_pool_nonces(signer_address, chain_id, next_nonce)
       VALUES ($1, $2, $3)
       ON CONFLICT (signer_address, chain_id) DO UPDATE SET next_nonce = GREATEST(
         $3,
         COALESCE((
           SELECT MAX(nonce) + 1 FROM ${this.schema}.tx_pool_transactions
           WHERE signer_address = $1 AND chain_id = $2 AND status IN ('pending', 'submitted', 'cancelling')
         ), 0)
       )`,
      [signerAddress, chainId.toString(), chainPendingNonce],
    );
  }

  private async appendAttempt(id: string, attempt: TxAttempt, status: 'submitted' | 'cancelling'): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.schema}.tx_pool_transactions
       SET attempts = attempts || $2::jsonb,
           attempt_count = attempt_count + 1,
           latest_hash = $3,
           status = $4,
           submitted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id, JSON.stringify([attempt]), attempt.hash, status],
    );
    if (result.rowCount === 0) throw new TxPoolError(`No pool tx with id ${id}`);
  }

  async markSubmitted(id: string, attempt: TxAttempt): Promise<void> {
    return this.appendAttempt(id, attempt, 'submitted');
  }

  async markCancelling(id: string, attempt: TxAttempt): Promise<void> {
    return this.appendAttempt(id, { ...attempt, cancel: true }, 'cancelling');
  }

  private async setTerminal(id: string, status: TxStatus, error: string | null, receipt: object | null): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.schema}.tx_pool_transactions
       SET status = $2,
           last_error = COALESCE($3, last_error),
           receipt = COALESCE($4, receipt),
           claimed_until = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id, status, error, receipt ? JSON.stringify(receipt) : null],
    );
    if (result.rowCount === 0) throw new TxPoolError(`No pool tx with id ${id}`);
  }

  async markConfirmed(id: string, receipt: object): Promise<void> {
    return this.setTerminal(id, 'confirmed', null, receipt);
  }

  async markFailed(id: string, error: string, receipt?: object): Promise<void> {
    return this.setTerminal(id, 'failed', error, receipt ?? null);
  }

  async markDropped(id: string, reason: string): Promise<void> {
    return this.setTerminal(id, 'dropped', reason, null);
  }

  async markCancelled(id: string, receipt: object): Promise<void> {
    return this.setTerminal(id, 'cancelled', null, receipt);
  }

  async recordError(id: string, error: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.schema}.tx_pool_transactions
       SET last_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id, error],
    );
    if (result.rowCount === 0) throw new TxPoolError(`No pool tx with id ${id}`);
  }

  private async claim(where: string, params: unknown[], limit: number, leaseMs: number): Promise<PoolTx[]> {
    // The subquery + SKIP LOCKED hands concurrent claimers disjoint row sets;
    // the lease keeps a row owned across the claimer's (non-DB) RPC work and
    // frees it for other replicas if the claimer dies.
    const result = await this.pool.query(
      `UPDATE ${this.schema}.tx_pool_transactions
       SET claimed_until = CURRENT_TIMESTAMP + ($${params.length + 1} * interval '1 millisecond'),
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (
         SELECT id FROM ${this.schema}.tx_pool_transactions
         WHERE ${where}
           AND (claimed_until IS NULL OR claimed_until < CURRENT_TIMESTAMP)
         ORDER BY nonce
         LIMIT $${params.length + 2}
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [...params, leaseMs, limit],
    );
    return result.rows.map(fromRow).sort((a, b) => a.nonce - b.nonce);
  }

  async claimActive(signerAddress: string, chainId: bigint, limit: number, leaseMs: number): Promise<PoolTx[]> {
    return this.claim(
      "signer_address = $1 AND chain_id = $2 AND status IN ('submitted', 'cancelling')",
      [signerAddress, chainId.toString()],
      limit,
      leaseMs,
    );
  }

  async claimStalePending(signerAddress: string, chainId: bigint, olderThanMs: number, leaseMs: number): Promise<PoolTx[]> {
    return this.claim(
      `signer_address = $1 AND chain_id = $2 AND status = 'pending'
       AND created_at < CURRENT_TIMESTAMP - ($3 * interval '1 millisecond')`,
      [signerAddress, chainId.toString(), olderThanMs],
      Number.MAX_SAFE_INTEGER,
      leaseMs,
    );
  }

  async releaseClaim(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.schema}.tx_pool_transactions
       SET claimed_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id],
    );
  }

  async findByHash(hash: string): Promise<PoolTx | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.tx_pool_transactions
       WHERE latest_hash = $1
          OR attempts @> jsonb_build_array(jsonb_build_object('hash', $1::text))
       LIMIT 1`,
      [hash],
    );
    return result.rows.length > 0 ? fromRow(result.rows[0]) : undefined;
  }

  async getById(id: string): Promise<PoolTx | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.tx_pool_transactions WHERE id = $1`,
      [id],
    );
    return result.rows.length > 0 ? fromRow(result.rows[0]) : undefined;
  }
}

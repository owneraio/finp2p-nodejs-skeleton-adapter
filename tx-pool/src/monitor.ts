import {
  Provider, Signer, TransactionReceipt, TransactionRequest,
} from 'ethers';
import { TxPoolStore } from './store/store';
import { ResolvedTxPoolConfig } from './config';
import { deserializeTxRequest, PoolTx, TxAttempt } from './types';
import { classifySendError, describeError } from './errors';
import { AttemptFees, attemptFees, bumpFees, feesOf } from './fees';
import { getLogger } from './logger';

const CANCEL_GAS_LIMIT = 21_000n;

const receiptJson = (r: TransactionReceipt) => ({
  hash: r.hash,
  blockNumber: r.blockNumber,
  blockHash: r.blockHash,
  index: r.index,
  status: r.status,
  gasUsed: r.gasUsed.toString(),
  effectiveGasPrice: r.gasPrice?.toString(),
});

const applyFees = (tx: TransactionRequest, fees: AttemptFees): void => {
  delete tx.gasPrice;
  delete tx.maxFeePerGas;
  delete tx.maxPriorityFeePerGas;
  if (fees.gasPrice !== undefined) {
    tx.gasPrice = fees.gasPrice;
  } else {
    tx.maxFeePerGas = fees.maxFeePerGas;
    tx.maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
    tx.type = 2;
  }
};

/**
 * Background loop driving submitted txs to a terminal state: polls receipts,
 * fee-bumps stuck txs, cancels after the resend cap, rebroadcasts rows that
 * crashed between insert and broadcast. Stateless between ticks — all state
 * lives in the store, so any replica's monitor can pick up any row (claims
 * are leased via the store's SKIP LOCKED semantics).
 */
export class TxMonitor {
  private timer: NodeJS.Timeout | null = null;

  private stopped = true;

  private inFlight: Promise<void> = Promise.resolve();

  private ids: { address: string, chainId: bigint } | null = null;

  constructor(
    private readonly signer: Signer,
    private readonly provider: Provider,
    private readonly store: TxPoolStore,
    private readonly config: ResolvedTxPoolConfig,
  ) {}

  private async resolveIds(): Promise<{ address: string, chainId: bigint }> {
    if (!this.ids) {
      const [address, network] = await Promise.all([
        this.signer.getAddress(),
        this.provider.getNetwork(),
      ]);
      this.ids = { address, chainId: network.chainId };
    }
    return this.ids;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.resolveIds();
    // First tick immediately: crash recovery for rows left behind by a
    // previous process.
    await this.runTick();
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inFlight;
  }

  private schedule(): void {
    if (this.stopped) return;
    // Recursive setTimeout, not setInterval: a slow tick must never overlap
    // the next one.
    this.timer = setTimeout(() => {
      this.runTick().finally(() => this.schedule());
    }, this.config.checkIntervalMs);
  }

  private runTick(): Promise<void> {
    this.inFlight = this.tickOnce().catch((e) => {
      getLogger().error('tx-pool: monitor tick failed', { error: describeError(e) });
    });
    return this.inFlight;
  }

  /** One monitor pass. Public so tests can drive the state machine deterministically. */
  async tickOnce(): Promise<void> {
    const { address, chainId } = await this.resolveIds();

    const claimed = await this.store.claimActive(address, chainId, this.config.claimBatchSize, this.config.claimLeaseMs);
    if (claimed.length > 0) {
      const [latestNonce, blockNumber] = await Promise.all([
        this.provider.getTransactionCount(address, 'latest'),
        this.provider.getBlockNumber(),
      ]);
      for (const row of claimed) {
        try {
          await this.handleActive(row, latestNonce, blockNumber);
        } catch (e) {
          getLogger().error('tx-pool: failed to process tx', { id: row.id, nonce: row.nonce, error: describeError(e) });
          await this.store.recordError(row.id, describeError(e)).catch(() => {});
        }
        await this.store.releaseClaim(row.id).catch(() => {});
      }
    }

    const stale = await this.store.claimStalePending(address, chainId, this.config.stuckTimeoutMs, this.config.claimLeaseMs);
    for (const row of stale) {
      try {
        await this.recoverPending(row, address);
      } catch (e) {
        getLogger().error('tx-pool: failed to recover pending tx', { id: row.id, nonce: row.nonce, error: describeError(e) });
        await this.store.recordError(row.id, describeError(e)).catch(() => {});
      }
      await this.store.releaseClaim(row.id).catch(() => {});
    }
  }

  private async findReceipt(row: PoolTx): Promise<{ receipt: TransactionReceipt, attempt: TxAttempt } | null> {
    // Newest attempt first — but any attempt can win the race.
    for (let i = row.attempts.length - 1; i >= 0; i -= 1) {
      const receipt = await this.provider.getTransactionReceipt(row.attempts[i].hash);
      if (receipt) return { receipt, attempt: row.attempts[i] };
    }
    return null;
  }

  private async handleActive(row: PoolTx, latestNonce: number, blockNumber: number): Promise<void> {
    const found = await this.findReceipt(row);

    if (found) {
      const confirmations = blockNumber - found.receipt.blockNumber + 1;
      if (confirmations < this.config.confirmations) return; // keep watching

      if (found.attempt.cancel) {
        getLogger().info('tx-pool: tx cancelled', { id: row.id, nonce: row.nonce, hash: found.receipt.hash });
        await this.store.markCancelled(row.id, receiptJson(found.receipt));
      } else if (found.receipt.status === 1) {
        await this.store.markConfirmed(row.id, receiptJson(found.receipt));
      } else {
        getLogger().warn('tx-pool: tx reverted', { id: row.id, nonce: row.nonce, hash: found.receipt.hash });
        await this.store.markFailed(row.id, 'transaction reverted', receiptJson(found.receipt));
      }
      return;
    }

    if (row.nonce < latestNonce) {
      // The nonce was consumed but none of our attempt hashes mined — an
      // external tx took it.
      getLogger().warn('tx-pool: nonce consumed externally, dropping', { id: row.id, nonce: row.nonce });
      await this.store.markDropped(row.id, 'nonce consumed by an external transaction');
      return;
    }

    const lastAttemptAt = row.submittedAt?.getTime() ?? row.createdAt.getTime();
    if (Date.now() - lastAttemptAt <= this.config.stuckTimeoutMs) return; // not stuck yet

    const shouldCancel = row.status === 'submitted' && row.attemptCount >= this.config.maxResends + 1;
    if (shouldCancel || row.status === 'cancelling') {
      await this.sendCancel(row);
    } else {
      await this.resend(row);
    }
  }

  private async bumpedFees(row: PoolTx): Promise<AttemptFees> {
    const last = attemptFees(row.attempts[row.attempts.length - 1]);
    const feeData = await this.provider.getFeeData();
    return bumpFees(last, feeData, this.config.feeBumpPercent);
  }

  /** Replaces the original tx: same payload, same nonce, bumped fees. */
  private async resend(row: PoolTx): Promise<void> {
    const tx = deserializeTxRequest(row.txRequest);
    tx.nonce = row.nonce;
    applyFees(tx, await this.bumpedFees(row));

    try {
      const resp = await this.signer.sendTransaction(tx);
      getLogger().info('tx-pool: resent with bumped fees', {
        id: row.id, nonce: row.nonce, attempt: row.attemptCount + 1, hash: resp.hash,
      });
      await this.store.markSubmitted(row.id, { hash: resp.hash, ...feesOf(resp), submittedAt: new Date().toISOString() });
    } catch (e) {
      await this.handleResendError(row, e);
    }
  }

  /** Burns the nonce with a 0-value self-transfer at bumped fees. */
  private async sendCancel(row: PoolTx): Promise<void> {
    const tx: TransactionRequest = {
      to: row.signerAddress,
      from: row.signerAddress,
      value: 0n,
      nonce: row.nonce,
      gasLimit: CANCEL_GAS_LIMIT,
      chainId: row.chainId,
    };
    applyFees(tx, await this.bumpedFees(row));

    try {
      const resp = await this.signer.sendTransaction(tx);
      getLogger().warn('tx-pool: resend cap reached, cancelling', { id: row.id, nonce: row.nonce, hash: resp.hash });
      await this.store.markCancelling(row.id, { hash: resp.hash, ...feesOf(resp), submittedAt: new Date().toISOString() });
    } catch (e) {
      await this.handleResendError(row, e);
    }
  }

  private async handleResendError(row: PoolTx, e: unknown): Promise<void> {
    switch (classifySendError(e)) {
      case 'already-known':
        // The exact raw tx is already in the mempool — nothing to do.
        return;
      case 'underpriced':
        // Record and bump harder next tick (bump base is the last recorded
        // attempt, which keeps growing).
        await this.store.recordError(row.id, describeError(e));
        return;
      case 'nonce-conflict':
        // Resolves via receipt or the dropped path on the next tick.
        return;
      default:
        // Transient RPC failures land here too; the tx may still mine, so
        // never mark terminal — record and retry next tick.
        await this.store.recordError(row.id, describeError(e));
    }
  }

  /** Rebroadcasts a row that crashed between insert and broadcast (nonce-gap blocker). */
  private async recoverPending(row: PoolTx, address: string): Promise<void> {
    const latestNonce = await this.provider.getTransactionCount(address, 'latest');
    if (row.nonce < latestNonce) {
      await this.store.markDropped(row.id, 'nonce consumed before first broadcast');
      return;
    }
    const tx = deserializeTxRequest(row.txRequest);
    tx.nonce = row.nonce;
    try {
      const resp = await this.signer.sendTransaction(tx);
      getLogger().info('tx-pool: recovered never-broadcast tx', { id: row.id, nonce: row.nonce, hash: resp.hash });
      await this.store.markSubmitted(row.id, { hash: resp.hash, ...feesOf(resp), submittedAt: new Date().toISOString() });
    } catch (e) {
      if (classifySendError(e) === 'fatal') {
        await this.store.markFailed(row.id, describeError(e));
      } else {
        await this.store.recordError(row.id, describeError(e));
      }
    }
  }
}

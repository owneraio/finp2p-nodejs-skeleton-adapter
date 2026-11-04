import path from 'node:path';
import winston from 'winston';
import { Pool } from 'pg';
import { Provider, Signer } from 'ethers';
import { TxPoolConfig, applyDefaults } from './config';
import { TxPoolStore, PgTxPoolStore, InMemoryTxPoolStore } from './store';
import { TxPoolSigner } from './signer';
import { TxMonitor } from './monitor';
import { wrapProvider } from './provider';
import { setLogger } from './logger';
import { TxPoolError } from './types';

export { TxPoolConfig, ResolvedTxPoolConfig, applyDefaults, DEFAULT_SCHEMA_NAME } from './config';
export {
  TxStatus, TxAttempt, PoolTx, NewPoolTx, SerializedTxRequest, TxPoolError,
  serializeTxRequest, deserializeTxRequest,
} from './types';
export { TxPoolStore, PgTxPoolStore, InMemoryTxPoolStore } from './store';
export { TxPoolSigner } from './signer';
export { TxMonitor } from './monitor';
export { wrapProvider } from './provider';
export { classifySendError, describeError, SendErrorKind } from './errors';
export { bumpFees, bump, feesOf, attemptFees, AttemptFees } from './fees';
export { setLogger } from './logger';

/** Directory containing tx-pool goose migration files */
export const migrationsDir = path.join(__dirname, '..', 'migrations');

/** Goose table name for tx-pool migrations */
export const migrationsTableName = 'finp2p_tx_pool_migrations';

export interface CreateTxPoolOptions {
  /** Underlying provider (e.g. JsonRpcProvider). */
  provider: Provider;
  /** Underlying signer (Wallet or JsonRpcSigner). Connected to `provider` if detached. */
  signer: Signer;
  /** PostgreSQL pool → PgTxPoolStore. The caller owns the pool lifecycle. */
  pool?: Pool;
  /** Alternative store (overrides `pool`), e.g. InMemoryTxPoolStore for DB-less dev. */
  store?: TxPoolStore;
  config?: TxPoolConfig;
  logger?: winston.Logger;
}

export interface TxPool {
  /** Drop-in Signer: nonce allocation, persistence, nonce-conflict retry. */
  signer: TxPoolSigner;
  /** Drop-in Provider: hash lookups survive fee-bump replacements. */
  provider: Provider;
  monitor: TxMonitor;
  store: TxPoolStore;
  /** Starts the monitor; the first tick recovers rows left by a crashed process. */
  start(): Promise<void>;
  /** Stops the monitor (awaits an in-flight tick). Does NOT end the pg Pool. */
  stop(): Promise<void>;
}

/**
 * Wires up the transaction pool around an ethers Provider/Signer pair.
 *
 * Multi-replica: any number of processes may share one signer key and one
 * database — nonces are allocated through a locked counter row and monitor
 * work is leased via FOR UPDATE SKIP LOCKED. With InMemoryTxPoolStore the
 * pool is single-process only.
 *
 * Usage:
 * ```
 * const pool = createTxPool({ provider, signer, pool: pgPool, config: { stuckTimeoutMs: 30_000 } });
 * await pool.start();
 * const contract = new Contract(address, abi, pool.signer);
 * const tx = await contract.transfer(to, amount);   // nonce managed, persisted, auto-resent
 * await pool.provider.waitForTransaction(tx.hash);  // resolves even if fee-bumped
 * ```
 */
export function createTxPool(opts: CreateTxPoolOptions): TxPool {
  if (opts.logger) {
    setLogger(opts.logger);
  }
  const config = applyDefaults(opts.config);

  let store: TxPoolStore;
  if (opts.store) {
    store = opts.store;
  } else if (opts.pool) {
    store = new PgTxPoolStore(opts.pool, config.schemaName);
  } else {
    throw new TxPoolError('createTxPool requires either a pg Pool or a TxPoolStore');
  }

  const inner = opts.signer.provider ? opts.signer : opts.signer.connect(opts.provider);
  const signer = new TxPoolSigner(inner, store, config, opts.provider);
  const monitor = new TxMonitor(inner, opts.provider, store, config);
  const provider = wrapProvider(opts.provider, store, Math.min(config.checkIntervalMs, 1_000));

  return {
    signer,
    provider,
    monitor,
    store,
    start: () => monitor.start(),
    stop: () => monitor.stop(),
  };
}

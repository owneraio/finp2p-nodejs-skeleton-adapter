/**
 * Default schema shared with the skeleton's tables. Keep in sync with the
 * `${LEDGER_SCHEMA:-ledger_adapter}` fallback in migrations/*.sql — newer
 * skeleton versions no longer export a schema-name constant.
 */
export const DEFAULT_SCHEMA_NAME = 'ledger_adapter';

export interface TxPoolConfig {
  /** "N": a tx pending longer than this is resent with bumped fees. Default 30_000. */
  stuckTimeoutMs?: number;
  /** Monitor tick cadence. Default 5_000. */
  checkIntervalMs?: number;
  /** Monitor claim lease; expired claims are re-claimable by any replica. Default 60_000. */
  claimLeaseMs?: number;
  /** Rows claimed per tick per replica. Default 50. */
  claimBatchSize?: number;
  /** Fee-bump attempts per tx; after the cap the tx is cancelled. Default 5. */
  maxResends?: number;
  /** Resync-and-retry attempts on nonce conflicts at send time. Default 3. */
  maxNonceRetries?: number;
  /** Applied to maxFeePerGas AND maxPriorityFeePerGas (geth requires >=10). Default 13. */
  feeBumpPercent?: number;
  /** Blocks on top of inclusion before a receipt is treated as final. Default 1. */
  confirmations?: number;
  /** PostgreSQL schema holding the tx-pool tables. Default 'ledger_adapter'. */
  schemaName?: string;
}

export type ResolvedTxPoolConfig = Required<TxPoolConfig>;

export function applyDefaults(config?: TxPoolConfig): ResolvedTxPoolConfig {
  return {
    stuckTimeoutMs: config?.stuckTimeoutMs ?? 30_000,
    checkIntervalMs: config?.checkIntervalMs ?? 5_000,
    claimLeaseMs: config?.claimLeaseMs ?? 60_000,
    claimBatchSize: config?.claimBatchSize ?? 50,
    maxResends: config?.maxResends ?? 5,
    maxNonceRetries: config?.maxNonceRetries ?? 3,
    feeBumpPercent: config?.feeBumpPercent ?? 13,
    confirmations: config?.confirmations ?? 1,
    schemaName: config?.schemaName ?? DEFAULT_SCHEMA_NAME,
  };
}

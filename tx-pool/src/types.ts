import { TransactionRequest, getBigInt } from 'ethers';

export type TxStatus = 'pending' | 'submitted' | 'cancelling' | 'confirmed' | 'failed' | 'dropped' | 'cancelled';

/** States for which the row's nonce is considered reserved (partial unique index). */
export const ACTIVE_STATUSES: TxStatus[] = ['pending', 'submitted', 'cancelling'];

export class TxPoolError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'TxPoolError';
  }
}

/** One broadcast attempt. Fee values are decimal strings (bigint-safe for jsonb). */
export interface TxAttempt {
  hash: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  submittedAt: string;
  /** true when this attempt is a 0-value self-transfer cancelling the original tx */
  cancel?: boolean;
}

/** TransactionRequest with bigints as decimal strings, safe for jsonb round-trips. */
export interface SerializedTxRequest {
  to?: string;
  from?: string;
  data?: string;
  value?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  chainId?: string;
  type?: number;
}

export interface NewPoolTx {
  signerAddress: string;
  chainId: bigint;
  txRequest: SerializedTxRequest;
}

export interface PoolTx {
  id: string;
  signerAddress: string;
  chainId: bigint;
  nonce: number;
  status: TxStatus;
  txRequest: SerializedTxRequest;
  attempts: TxAttempt[];
  latestHash: string | null;
  attemptCount: number;
  claimedUntil: Date | null;
  lastError: string | null;
  receipt: object | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
}

const asString = (v: unknown, field: string): string => {
  if (typeof v !== 'string') {
    throw new TxPoolError(`Cannot serialize tx: field '${field}' is not a resolved string (got ${typeof v}). Populate the transaction first.`);
  }
  return v;
};

export function serializeTxRequest(tx: TransactionRequest): SerializedTxRequest {
  const out: SerializedTxRequest = {};
  if (tx.to !== undefined && tx.to !== null) out.to = asString(tx.to, 'to');
  if (tx.from !== undefined && tx.from !== null) out.from = asString(tx.from, 'from');
  if (tx.data !== undefined && tx.data !== null) out.data = tx.data;
  if (tx.value !== undefined && tx.value !== null) out.value = getBigInt(tx.value).toString();
  if (tx.gasLimit !== undefined && tx.gasLimit !== null) out.gasLimit = getBigInt(tx.gasLimit).toString();
  if (tx.gasPrice !== undefined && tx.gasPrice !== null) out.gasPrice = getBigInt(tx.gasPrice).toString();
  if (tx.maxFeePerGas !== undefined && tx.maxFeePerGas !== null) out.maxFeePerGas = getBigInt(tx.maxFeePerGas).toString();
  if (tx.maxPriorityFeePerGas !== undefined && tx.maxPriorityFeePerGas !== null) out.maxPriorityFeePerGas = getBigInt(tx.maxPriorityFeePerGas).toString();
  if (tx.chainId !== undefined && tx.chainId !== null) out.chainId = getBigInt(tx.chainId).toString();
  if (tx.type !== undefined && tx.type !== null) out.type = tx.type;
  return out;
}

export function deserializeTxRequest(s: SerializedTxRequest): TransactionRequest {
  const out: TransactionRequest = {};
  if (s.to !== undefined) out.to = s.to;
  if (s.from !== undefined) out.from = s.from;
  if (s.data !== undefined) out.data = s.data;
  if (s.value !== undefined) out.value = BigInt(s.value);
  if (s.gasLimit !== undefined) out.gasLimit = BigInt(s.gasLimit);
  if (s.gasPrice !== undefined) out.gasPrice = BigInt(s.gasPrice);
  if (s.maxFeePerGas !== undefined) out.maxFeePerGas = BigInt(s.maxFeePerGas);
  if (s.maxPriorityFeePerGas !== undefined) out.maxPriorityFeePerGas = BigInt(s.maxPriorityFeePerGas);
  if (s.chainId !== undefined) out.chainId = BigInt(s.chainId);
  if (s.type !== undefined) out.type = s.type;
  return out;
}

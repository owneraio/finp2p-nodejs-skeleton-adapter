import { FeeData, TransactionResponse } from 'ethers';
import { TxAttempt } from './types';

export interface AttemptFees {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
}

/** v * (100 + pct) / 100, rounded up — rounding down could miss the node's replacement threshold. */
export function bump(v: bigint, pct: number): bigint {
  return v + (v * BigInt(pct) + 99n) / 100n;
}

const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);

export function attemptFees(attempt: TxAttempt | undefined): AttemptFees | null {
  if (!attempt) return null;
  const fees: AttemptFees = {};
  if (attempt.maxFeePerGas !== undefined) fees.maxFeePerGas = BigInt(attempt.maxFeePerGas);
  if (attempt.maxPriorityFeePerGas !== undefined) fees.maxPriorityFeePerGas = BigInt(attempt.maxPriorityFeePerGas);
  if (attempt.gasPrice !== undefined) fees.gasPrice = BigInt(attempt.gasPrice);
  if (fees.maxFeePerGas === undefined && fees.gasPrice === undefined) return null;
  return fees;
}

/**
 * Computes replacement fees: at least `pct` percent above the previous attempt
 * (both EIP-1559 fields — geth enforces the threshold on each), and never below
 * the network's current fee estimate.
 *
 * With no previous fees recorded (first attempt was node-populated), bumps the
 * current network estimate instead, as the best guess above the original.
 */
export function bumpFees(prev: AttemptFees | null, feeData: FeeData, pct: number): AttemptFees {
  const legacy = prev !== null
    ? prev.gasPrice !== undefined && prev.maxFeePerGas === undefined
    : feeData.maxFeePerGas === null;

  if (legacy) {
    const base = prev?.gasPrice ?? feeData.gasPrice ?? 0n;
    return { gasPrice: maxBig(bump(base, pct), feeData.gasPrice ?? 0n) };
  }

  const prevMaxFee = prev?.maxFeePerGas ?? feeData.maxFeePerGas ?? 0n;
  const prevPriority = prev?.maxPriorityFeePerGas ?? feeData.maxPriorityFeePerGas ?? 0n;
  const maxPriorityFeePerGas = maxBig(bump(prevPriority, pct), feeData.maxPriorityFeePerGas ?? 0n);
  let maxFeePerGas = maxBig(bump(prevMaxFee, pct), feeData.maxFeePerGas ?? 0n);
  maxFeePerGas = maxBig(maxFeePerGas, maxPriorityFeePerGas);
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/** Extracts the fee fields of a broadcast response for attempt bookkeeping. */
export function feesOf(resp: TransactionResponse): Pick<TxAttempt, 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasPrice'> {
  const out: Pick<TxAttempt, 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasPrice'> = {};
  if (resp.maxFeePerGas !== null && resp.maxFeePerGas !== undefined) out.maxFeePerGas = resp.maxFeePerGas.toString();
  if (resp.maxPriorityFeePerGas !== null && resp.maxPriorityFeePerGas !== undefined) out.maxPriorityFeePerGas = resp.maxPriorityFeePerGas.toString();
  if (resp.gasPrice !== null && resp.gasPrice !== undefined && out.maxFeePerGas === undefined) out.gasPrice = resp.gasPrice.toString();
  return out;
}

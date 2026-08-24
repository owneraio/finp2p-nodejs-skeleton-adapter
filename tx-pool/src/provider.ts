import { Provider, TransactionReceipt, TransactionResponse } from 'ethers';
import { TxPoolStore } from './store/store';

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Wraps a Provider so that hash-based lookups survive fee-bump replacements:
 * a caller holding the hash of any recorded attempt gets answers for whichever
 * attempt actually mined. Everything else passes through untouched.
 *
 * Implemented as a Proxy — subclassing is impossible (the concrete provider
 * class is unknown) and reimplementing the full Provider surface is not worth
 * it for three methods.
 */
export function wrapProvider<P extends Provider>(provider: P, store: TxPoolStore, pollIntervalMs: number): P {
  const attemptHashesOf = async (hash: string): Promise<string[]> => {
    const row = await store.findByHash(hash);
    if (!row) return [hash];
    const recorded = (row.receipt as { hash?: string } | null)?.hash;
    // Most likely first: receipt recorded by the monitor, then newest attempt.
    const ordered = [
      ...(recorded ? [recorded] : []),
      ...row.attempts.map((a) => a.hash).reverse(),
    ];
    return [...new Set(ordered)];
  };

  const getTransactionReceipt = async (hash: string): Promise<null | TransactionReceipt> => {
    const direct = await provider.getTransactionReceipt(hash);
    if (direct) return direct;
    for (const candidate of await attemptHashesOf(hash)) {
      if (candidate !== hash) {
        const receipt = await provider.getTransactionReceipt(candidate);
        if (receipt) return receipt;
      }
    }
    return null;
  };

  const getTransaction = async (hash: string): Promise<null | TransactionResponse> => {
    const direct = await provider.getTransaction(hash);
    if (direct) return direct;
    for (const candidate of await attemptHashesOf(hash)) {
      if (candidate !== hash) {
        const tx = await provider.getTransaction(candidate);
        if (tx) return tx;
      }
    }
    return null;
  };

  const waitForTransaction = async (
    hash: string,
    confirms?: number,
    timeout?: number,
  ): Promise<null | TransactionReceipt> => {
    const row = await store.findByHash(hash);
    if (!row) return provider.waitForTransaction(hash, confirms, timeout);

    const started = Date.now();
    for (;;) {
      // Re-resolve every iteration: the monitor may append new attempts.
      const receipt = await getTransactionReceipt(hash);
      if (receipt) {
        if (confirms !== undefined && confirms > 1) {
          const remaining = timeout !== undefined ? Math.max(1, timeout - (Date.now() - started)) : undefined;
          return provider.waitForTransaction(receipt.hash, confirms, remaining);
        }
        return receipt;
      }
      if (timeout !== undefined && Date.now() - started >= timeout) return null;
      await sleep(pollIntervalMs);
    }
  };

  const overrides: Record<PropertyKey, unknown> = { getTransactionReceipt, getTransaction, waitForTransaction };

  return new Proxy(provider, {
    get(target, prop) {
      if (prop in overrides) return overrides[prop];
      // Bind to the target, not the proxy: ethers classes use #private fields
      // that break when methods run with the proxy as `this`.
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

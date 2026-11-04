import {
  AbstractSigner, Provider, Signer, TransactionRequest, TransactionResponse,
  TypedDataDomain, TypedDataField, copyRequest, getNumber,
} from 'ethers';
import { TxPoolStore } from './store/store';
import { ResolvedTxPoolConfig } from './config';
import { serializeTxRequest, TxPoolError } from './types';
import { classifySendError, describeError } from './errors';
import { feesOf } from './fees';
import { getLogger } from './logger';

/**
 * Drop-in ethers Signer. sendTransaction allocates the nonce through the
 * store (multi-replica safe), persists the tx before broadcast, and retries
 * with a resynced nonce on nonce conflicts. Everything else delegates to the
 * wrapped signer.
 *
 * Broadcasts go through inner.sendTransaction (not sign+broadcast) so both
 * Wallet and JsonRpcSigner (node-managed keys) work.
 */
export class TxPoolSigner extends AbstractSigner {
  private tail: Promise<unknown> = Promise.resolve();

  private cachedIds: { address: string, chainId: bigint } | null = null;

  constructor(
    private readonly inner: Signer,
    private readonly store: TxPoolStore,
    private readonly config: ResolvedTxPoolConfig,
    provider?: Provider,
  ) {
    super(provider ?? inner.provider ?? undefined);
    if (!this.provider) {
      throw new TxPoolError('TxPoolSigner requires a provider (on the inner signer or passed explicitly)');
    }
  }

  /** Serializes nonce allocation + broadcast within this replica. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }

  async ids(): Promise<{ address: string, chainId: bigint }> {
    if (!this.cachedIds) {
      const [address, network] = await Promise.all([
        this.inner.getAddress(),
        this.provider!.getNetwork(),
      ]);
      this.cachedIds = { address, chainId: network.chainId };
    }
    return this.cachedIds;
  }

  getAddress(): Promise<string> {
    return this.inner.getAddress();
  }

  connect(provider: null | Provider): Signer {
    return new TxPoolSigner(this.inner.connect(provider), this.store, this.config, provider ?? undefined);
  }

  signTransaction(tx: TransactionRequest): Promise<string> {
    return this.inner.signTransaction(tx);
  }

  signMessage(message: string | Uint8Array): Promise<string> {
    return this.inner.signMessage(message);
  }

  signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, any>): Promise<string> {
    return this.inner.signTypedData(domain, types, value);
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    return this.locked(async () => {
      const { address, chainId } = await this.ids();
      const explicitNonce = tx.nonce !== undefined && tx.nonce !== null ? getNumber(tx.nonce) : null;

      // Resolve fees/gas/chainId/addresses up front so the persisted payload is
      // complete enough to rebroadcast verbatim after a crash. The nonce it
      // picks is discarded — the store allocates the real one.
      const populated = await this.inner.populateTransaction(copyRequest(tx));
      delete populated.nonce;
      const serialized = serializeTxRequest(populated);

      const initNonce = () => this.provider!.getTransactionCount(address, 'pending');

      for (let attempt = 0; attempt < this.config.maxNonceRetries; attempt += 1) {
        const row = await this.store.allocateAndInsert(
          { signerAddress: address, chainId, txRequest: serialized },
          explicitNonce,
          initNonce,
        );
        try {
          const resp = await this.inner.sendTransaction({ ...populated, nonce: row.nonce });
          await this.store.markSubmitted(row.id, {
            hash: resp.hash,
            ...feesOf(resp),
            submittedAt: new Date().toISOString(),
          });
          return resp;
        } catch (e) {
          const kind = classifySendError(e);
          await this.store.markFailed(row.id, describeError(e));
          // Resync after any failed broadcast: the freed nonce must not stay
          // skipped, or every later tx queues behind the gap forever.
          await this.store.resyncNonce(address, chainId, await initNonce());
          if ((kind !== 'nonce-conflict' && kind !== 'underpriced') || explicitNonce !== null) {
            throw e;
          }
          getLogger().warn('tx-pool: nonce conflict on send, resyncing', { nonce: row.nonce, error: describeError(e) });
        }
      }
      throw new TxPoolError(`Nonce retries exhausted after ${this.config.maxNonceRetries} attempts`);
    });
  }
}

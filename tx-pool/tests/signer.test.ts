import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { TxPoolSigner } from '../src/signer';
import { InMemoryTxPoolStore } from '../src/store';
import { applyDefaults } from '../src/config';
import { TxPoolError } from '../src/types';
import { testProvider, mine, setBalance, pendingTxHashes } from './anvil';

describe('TxPoolSigner', () => {
  let container: { rpcUrl: string, cleanup: () => Promise<void> };
  let provider: JsonRpcProvider;
  let wallet: Wallet;
  let store: InMemoryTxPoolStore;
  let signer: TxPoolSigner;

  beforeAll(async () => {
    container = await global.startAnvilContainer();
  });

  afterAll(async () => {
    await container.cleanup();
  });

  beforeEach(async () => {
    provider = testProvider(container.rpcUrl);
    wallet = new Wallet(Wallet.createRandom().privateKey, provider);
    await setBalance(provider, wallet.address, parseEther('100'));
    store = new InMemoryTxPoolStore();
    signer = new TxPoolSigner(wallet, store, applyDefaults());
  });

  afterEach(() => {
    provider.destroy();
  });

  test('populates nonce, persists row, broadcasts', async () => {
    const resp = await signer.sendTransaction({ to: wallet.address, value: 1n });
    expect(resp.nonce).toBe(0);
    expect(await pendingTxHashes(provider)).toContain(resp.hash);

    const row = (await store.findByHash(resp.hash))!;
    expect(row.status).toBe('submitted');
    expect(row.nonce).toBe(0);
    expect(row.attemptCount).toBe(1);
    expect(row.txRequest.to).toBe(wallet.address);
    expect(row.txRequest.maxFeePerGas).toBeDefined();
    expect(row.attempts[0].maxFeePerGas).toBeDefined();

    await mine(provider);
    const receipt = await provider.getTransactionReceipt(resp.hash);
    expect(receipt!.status).toBe(1);
  });

  test('sequential sends increment the nonce without mining', async () => {
    const a = await signer.sendTransaction({ to: wallet.address, value: 1n });
    const b = await signer.sendTransaction({ to: wallet.address, value: 1n });
    const c = await signer.sendTransaction({ to: wallet.address, value: 1n });
    expect([a.nonce, b.nonce, c.nonce]).toEqual([0, 1, 2]);
  });

  test('concurrent sends serialize into distinct nonces', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => signer.sendTransaction({ to: wallet.address, value: 1n })));
    expect(responses.map((r) => r.nonce).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
    await mine(provider);
    const receipts = await Promise.all(responses.map((r) => provider.getTransactionReceipt(r.hash)));
    expect(receipts.every((r) => r?.status === 1)).toBe(true);
  });

  test('nonce conflict: resyncs and retries on a fresh nonce', async () => {
    const first = await signer.sendTransaction({ to: wallet.address, value: 1n });
    expect(first.nonce).toBe(0);
    await mine(provider);

    // Consume nonce 1 behind the pool's back.
    const external = await wallet.sendTransaction({ to: wallet.address, value: 2n, nonce: 1 });
    await mine(provider);
    expect((await provider.getTransactionReceipt(external.hash))!.status).toBe(1);

    // Pool counter still says 1 → broadcast fails with nonce-too-low → resync → 2.
    const resp = await signer.sendTransaction({ to: wallet.address, value: 3n });
    expect(resp.nonce).toBe(2);

    const failed = (await store.getById((await store.findByHash(resp.hash))!.id))!;
    expect(failed.status).toBe('submitted');
    await mine(provider);
    expect((await provider.getTransactionReceipt(resp.hash))!.status).toBe(1);
  });

  test('fatal broadcast error marks the row failed and rethrows', async () => {
    const poor = new Wallet(Wallet.createRandom().privateKey, provider);
    const poorStore = new InMemoryTxPoolStore();
    const poorSigner = new TxPoolSigner(poor, poorStore, applyDefaults());

    await expect(poorSigner.sendTransaction({
      to: wallet.address,
      value: parseEther('1'),
      gasLimit: 21000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    })).rejects.toThrow();

    // Row was inserted (nonce 0) and marked failed; nonce freed for reuse.
    await setBalance(provider, poor.address, parseEther('1'));
    const resp = await poorSigner.sendTransaction({ to: wallet.address, value: 1n });
    expect(resp.nonce).toBe(0);
  });

  test('explicit nonce is honored and not retried', async () => {
    const resp = await signer.sendTransaction({ to: wallet.address, value: 1n, nonce: 0 });
    expect(resp.nonce).toBe(0);
    await mine(provider);

    await expect(signer.sendTransaction({ to: wallet.address, value: 1n, nonce: 0 })).rejects.toThrow();
  });

  test('requires a provider', () => {
    const detached = new Wallet(Wallet.createRandom().privateKey);
    expect(() => new TxPoolSigner(detached, store, applyDefaults())).toThrow(TxPoolError);
  });
});

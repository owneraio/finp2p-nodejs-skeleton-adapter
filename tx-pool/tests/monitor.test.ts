import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { TxPoolSigner } from '../src/signer';
import { TxMonitor } from '../src/monitor';
import { InMemoryTxPoolStore } from '../src/store';
import { applyDefaults, TxPoolConfig } from '../src/config';
import { serializeTxRequest, PoolTx } from '../src/types';
import { testProvider, mine, setBalance, dropTransaction, pendingTxHashes } from './anvil';

// Init code returning runtime bytecode 0xfe (INVALID) — any call reverts.
const REVERTING_CONTRACT_INIT = '0x60fe60005360016000f3';

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

describe('TxMonitor', () => {
  let container: { rpcUrl: string, cleanup: () => Promise<void> };
  let provider: JsonRpcProvider;
  let wallet: Wallet;
  let store: InMemoryTxPoolStore;
  let signer: TxPoolSigner;

  const newMonitor = (config?: TxPoolConfig) => new TxMonitor(
    wallet,
    provider,
    store,
    applyDefaults({ stuckTimeoutMs: 100, checkIntervalMs: 50, maxResends: 1, ...config }),
  );

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

  const rowOf = async (hash: string): Promise<PoolTx> => (await store.findByHash(hash))!;

  test('bumps fees on a stuck tx; replacement confirms', async () => {
    const monitor = newMonitor();
    const resp = await signer.sendTransaction({ to: wallet.address, value: 1n });

    await sleep(150);
    await monitor.tickOnce();

    let row = await rowOf(resp.hash);
    expect(row.status).toBe('submitted');
    expect(row.attemptCount).toBe(2);
    const [first, second] = row.attempts;
    expect(BigInt(second.maxFeePerGas!) * 100n).toBeGreaterThanOrEqual(BigInt(first.maxFeePerGas!) * 113n);
    expect(BigInt(second.maxPriorityFeePerGas!) * 100n).toBeGreaterThanOrEqual(BigInt(first.maxPriorityFeePerGas!) * 113n);

    // The replacement evicted the original from the mempool.
    const mempool = await pendingTxHashes(provider);
    expect(mempool).toContain(second.hash);
    expect(mempool).not.toContain(first.hash);

    await mine(provider);
    await monitor.tickOnce();
    row = await rowOf(resp.hash);
    expect(row.status).toBe('confirmed');
    expect((row.receipt as { hash: string }).hash).toBe(second.hash);
    expect((row.receipt as { status: number }).status).toBe(1);
  });

  test('cancels after the resend cap; cancel receipt marks cancelled', async () => {
    const monitor = newMonitor({ maxResends: 1 });
    const resp = await signer.sendTransaction({ to: wallet.address, value: 1n });

    await sleep(150);
    await monitor.tickOnce(); // resend (attempt 2)
    await sleep(150);
    await monitor.tickOnce(); // cap reached → cancel (attempt 3)

    let row = await rowOf(resp.hash);
    expect(row.status).toBe('cancelling');
    expect(row.attemptCount).toBe(3);
    expect(row.attempts[2].cancel).toBe(true);

    await mine(provider);
    await monitor.tickOnce();
    row = await rowOf(resp.hash);
    expect(row.status).toBe('cancelled');
    expect((row.receipt as { hash: string }).hash).toBe(row.attempts[2].hash);
    // The nonce was burned by the 0-value self-transfer.
    expect(await provider.getTransactionCount(wallet.address, 'latest')).toBe(resp.nonce + 1);
  });

  test('keeps bumping the cancel tx if it is stuck too', async () => {
    const monitor = newMonitor({ maxResends: 0 });
    const resp = await signer.sendTransaction({ to: wallet.address, value: 1n });

    await sleep(150);
    await monitor.tickOnce(); // cap (0 resends) → cancel
    await sleep(150);
    await monitor.tickOnce(); // cancel still stuck → bumped cancel

    const row = await rowOf(resp.hash);
    expect(row.status).toBe('cancelling');
    expect(row.attemptCount).toBe(3);
    expect(row.attempts[1].cancel).toBe(true);
    expect(row.attempts[2].cancel).toBe(true);

    await mine(provider);
    await monitor.tickOnce();
    expect((await rowOf(resp.hash)).status).toBe('cancelled');
  });

  test('reverted tx is marked failed with the receipt', async () => {
    const deploy = await wallet.sendTransaction({ data: REVERTING_CONTRACT_INIT });
    await mine(provider);
    const contract = (await provider.getTransactionReceipt(deploy.hash))!.contractAddress!;

    const monitor = newMonitor();
    const resp = await signer.sendTransaction({ to: contract, gasLimit: 100_000n });
    await mine(provider);
    await monitor.tickOnce();

    const row = await rowOf(resp.hash);
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('transaction reverted');
    expect((row.receipt as { status: number }).status).toBe(0);
  });

  test('externally consumed nonce marks the row dropped', async () => {
    const monitor = newMonitor();
    const resp = await signer.sendTransaction({ to: wallet.address, value: 1n });
    await dropTransaction(provider, resp.hash);

    const external = await wallet.sendTransaction({ to: wallet.address, value: 7n, nonce: resp.nonce });
    await mine(provider);
    expect((await provider.getTransactionReceipt(external.hash))!.status).toBe(1);

    await monitor.tickOnce();
    const row = await rowOf(resp.hash);
    expect(row.status).toBe('dropped');
    expect(row.lastError).toMatch(/external/);
  });

  test('recovers a never-broadcast pending row (crash between insert and send)', async () => {
    const populated = await wallet.populateTransaction({ to: wallet.address, value: 5n });
    delete populated.nonce;
    const inserted = await store.allocateAndInsert(
      { signerAddress: wallet.address, chainId: 31337n, txRequest: serializeTxRequest(populated) },
      null,
      async () => provider.getTransactionCount(wallet.address, 'pending'),
    );

    const monitor = newMonitor();
    await sleep(150);
    await monitor.tickOnce();

    let row = (await store.getById(inserted.id))!;
    expect(row.status).toBe('submitted');
    expect(row.latestHash).not.toBeNull();

    await mine(provider);
    await monitor.tickOnce();
    row = (await store.getById(inserted.id))!;
    expect(row.status).toBe('confirmed');
  });

  test('waits for the configured number of confirmations', async () => {
    const monitor = newMonitor({ confirmations: 3 });
    const resp = await signer.sendTransaction({ to: wallet.address, value: 1n });

    await mine(provider); // inclusion = 1 confirmation
    await monitor.tickOnce();
    expect((await rowOf(resp.hash)).status).toBe('submitted');

    await mine(provider, 2); // 3 confirmations
    await monitor.tickOnce();
    expect((await rowOf(resp.hash)).status).toBe('confirmed');
  });

  test('original attempt mining while cancelling resolves to confirmed', async () => {
    const resp = await signer.sendTransaction({ to: wallet.address, value: 1n });
    const row = await rowOf(resp.hash);
    // Simulate a cancel replacement that lost the race: recorded, never mined.
    await store.markCancelling(row.id, { hash: `0x${'ab'.repeat(32)}`, submittedAt: new Date().toISOString() });

    await mine(provider); // mines the ORIGINAL attempt
    const monitor = newMonitor();
    await monitor.tickOnce();

    const final = (await store.getById(row.id))!;
    expect(final.status).toBe('confirmed');
    expect((final.receipt as { hash: string }).hash).toBe(resp.hash);
  });

  test('start/stop loop confirms a mined tx without manual ticks', async () => {
    const monitor = newMonitor({ stuckTimeoutMs: 10_000 });
    await monitor.start();
    try {
      const resp = await signer.sendTransaction({ to: wallet.address, value: 1n });
      await mine(provider);
      const deadline = Date.now() + 5_000;
      let row = await rowOf(resp.hash);
      while (row.status !== 'confirmed' && Date.now() < deadline) {
        await sleep(50);
        row = await rowOf(resp.hash);
      }
      expect(row.status).toBe('confirmed');
    } finally {
      await monitor.stop();
    }
  });
});

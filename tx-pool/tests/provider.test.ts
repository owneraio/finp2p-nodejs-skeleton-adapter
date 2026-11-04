import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { createTxPool, TxPool, InMemoryTxPoolStore } from '../src';
import { testProvider, mine, setBalance } from './anvil';

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

describe('wrapped provider', () => {
  let container: { rpcUrl: string, cleanup: () => Promise<void> };
  let provider: JsonRpcProvider;
  let wallet: Wallet;
  let pool: TxPool;

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
    pool = createTxPool({
      provider,
      signer: wallet,
      store: new InMemoryTxPoolStore(),
      config: { stuckTimeoutMs: 100, checkIntervalMs: 50 },
    });
  });

  afterEach(async () => {
    await pool.stop();
    provider.destroy();
  });

  test('passes unrelated calls through', async () => {
    expect(typeof await pool.provider.getBlockNumber()).toBe('number');
    expect(await pool.provider.getTransactionReceipt(`0x${'00'.repeat(32)}`)).toBeNull();
    expect((await pool.provider.getNetwork()).chainId).toBe(31337n);
  });

  test('getTransactionReceipt translates a replaced hash to the mined replacement', async () => {
    const resp = await pool.signer.sendTransaction({ to: wallet.address, value: 1n });
    await sleep(150);
    await pool.monitor.tickOnce(); // fee bump → new hash
    await mine(provider);

    const receipt = await pool.provider.getTransactionReceipt(resp.hash);
    expect(receipt).not.toBeNull();
    expect(receipt!.hash).not.toBe(resp.hash);
    expect(receipt!.status).toBe(1);

    const row = (await pool.store.findByHash(resp.hash))!;
    expect(receipt!.hash).toBe(row.attempts[1].hash);
  });

  test('getTransaction translates a replaced hash', async () => {
    const resp = await pool.signer.sendTransaction({ to: wallet.address, value: 1n });
    await sleep(150);
    await pool.monitor.tickOnce();

    const tx = await pool.provider.getTransaction(resp.hash);
    expect(tx).not.toBeNull();
    expect(tx!.nonce).toBe(resp.nonce);
    expect(tx!.hash).not.toBe(resp.hash);
  });

  test('waitForTransaction on the original hash resolves with the replacement receipt', async () => {
    const resp = await pool.signer.sendTransaction({ to: wallet.address, value: 1n });

    const waiting = pool.provider.waitForTransaction(resp.hash, undefined, 10_000);
    await sleep(150);
    await pool.monitor.tickOnce(); // deterministic fee bump → replacement hash
    await mine(provider);

    const receipt = await waiting;
    expect(receipt).not.toBeNull();
    expect(receipt!.status).toBe(1);
    const row = (await pool.store.findByHash(resp.hash))!;
    expect(row.attempts.length).toBeGreaterThan(1);
    expect(row.attempts.map((a) => a.hash)).toContain(receipt!.hash);
  });

  test('waitForTransaction times out with null for a never-mined pool tx', async () => {
    const resp = await pool.signer.sendTransaction({ to: wallet.address, value: 1n });
    const receipt = await pool.provider.waitForTransaction(resp.hash, undefined, 300);
    expect(receipt).toBeNull();
  });

  test('waitForTransaction falls through to the raw provider for unknown hashes', async () => {
    const external = await wallet.sendTransaction({ to: wallet.address, value: 1n });
    const waiting = pool.provider.waitForTransaction(external.hash, undefined, 10_000);
    // Raw waitForTransaction watches block events — let the subscription
    // register before mining, or the instantly-mined block is missed.
    await sleep(500);
    await mine(provider);
    const receipt = await waiting;
    expect(receipt!.hash).toBe(external.hash);
  });
});

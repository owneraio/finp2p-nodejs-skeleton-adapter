import { JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { Pool } from 'pg';
import { createTxPool, TxPool, PgTxPoolStore } from '../src';
import { runMigrations } from './migrate';
import { testProvider, mine, setBalance } from './anvil';

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

describe('multi-replica: two pools, one signer key, one database', () => {
  let anvil: { rpcUrl: string, cleanup: () => Promise<void> };
  let postgres: { connectionString: string, cleanup: () => Promise<void> };
  let pgPoolA: Pool;
  let pgPoolB: Pool;
  let providerA: JsonRpcProvider;
  let providerB: JsonRpcProvider;
  let key: string;
  let address: string;
  let replicaA: TxPool;
  let replicaB: TxPool;

  beforeAll(async () => {
    [anvil, postgres] = await Promise.all([
      global.startAnvilContainer(),
      global.startPostgresContainer(),
    ]);
    const goosePath = await global.whichGoose();
    await runMigrations(goosePath, postgres.connectionString);
  });

  afterAll(async () => {
    await anvil.cleanup();
    await postgres.cleanup();
  });

  beforeEach(async () => {
    // Each replica gets its own pg pool and RPC connection, like separate processes.
    pgPoolA = new Pool({ connectionString: postgres.connectionString });
    pgPoolB = new Pool({ connectionString: postgres.connectionString });
    providerA = testProvider(anvil.rpcUrl);
    providerB = testProvider(anvil.rpcUrl);
    key = Wallet.createRandom().privateKey;
    address = new Wallet(key).address;
    await setBalance(providerA, address, parseEther('100'));

    const config = { stuckTimeoutMs: 100, checkIntervalMs: 50, claimLeaseMs: 60_000 };
    replicaA = createTxPool({ provider: providerA, signer: new Wallet(key, providerA), pool: pgPoolA, config });
    replicaB = createTxPool({ provider: providerB, signer: new Wallet(key, providerB), pool: pgPoolB, config });
  });

  afterEach(async () => {
    await replicaA.stop();
    await replicaB.stop();
    providerA.destroy();
    providerB.destroy();
    await pgPoolA.end();
    await pgPoolB.end();
  });

  test('interleaved sends across replicas get disjoint sequential nonces', async () => {
    const responses = await Promise.all([
      replicaA.signer.sendTransaction({ to: address, value: 1n }),
      replicaB.signer.sendTransaction({ to: address, value: 2n }),
      replicaA.signer.sendTransaction({ to: address, value: 3n }),
      replicaB.signer.sendTransaction({ to: address, value: 4n }),
      replicaA.signer.sendTransaction({ to: address, value: 5n }),
      replicaB.signer.sendTransaction({ to: address, value: 6n }),
    ]);
    expect(responses.map((r) => r.nonce).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);

    await mine(providerA);
    const receipts = await Promise.all(responses.map((r) => providerA.getTransactionReceipt(r.hash)));
    expect(receipts.every((r) => r?.status === 1)).toBe(true);
  });

  test('concurrent monitors bump each stuck tx exactly once', async () => {
    const a = await replicaA.signer.sendTransaction({ to: address, value: 1n });
    const b = await replicaB.signer.sendTransaction({ to: address, value: 2n });
    await sleep(150);

    await Promise.all([replicaA.monitor.tickOnce(), replicaB.monitor.tickOnce()]);

    for (const hash of [a.hash, b.hash]) {
      const row = (await replicaA.store.findByHash(hash))!;
      expect(row.attemptCount).toBe(2); // one bump total, not one per replica
    }

    await mine(providerA);
    await Promise.all([replicaA.monitor.tickOnce(), replicaB.monitor.tickOnce()]);
    for (const hash of [a.hash, b.hash]) {
      expect((await replicaA.store.findByHash(hash))!.status).toBe('confirmed');
    }
  });

  test('a dead replica\'s claim expires and the other replica takes over', async () => {
    const resp = await replicaA.signer.sendTransaction({ to: address, value: 1n });
    await sleep(150);

    // Replica A claims the row with a short lease and "dies" (never processes).
    const storeA = new PgTxPoolStore(pgPoolA);
    const claimed = await storeA.claimActive(address, 31337n, 10, 300);
    expect(claimed.length).toBe(1);

    // While the lease is held, B cannot touch the row.
    await replicaB.monitor.tickOnce();
    expect((await replicaB.store.findByHash(resp.hash))!.attemptCount).toBe(1);

    // After expiry, B picks it up and bumps.
    await sleep(400);
    await replicaB.monitor.tickOnce();
    expect((await replicaB.store.findByHash(resp.hash))!.attemptCount).toBe(2);
  });

  test('replica B recovers a tx that replica A inserted but never broadcast', async () => {
    // Simulate A crashing between insert and broadcast.
    const wallet = new Wallet(key, providerA);
    const populated = await wallet.populateTransaction({ to: address, value: 9n });
    delete populated.nonce;
    const { serializeTxRequest } = await import('../src/types');
    const inserted = await replicaA.store.allocateAndInsert(
      { signerAddress: address, chainId: 31337n, txRequest: serializeTxRequest(populated) },
      null,
      async () => providerA.getTransactionCount(address, 'pending'),
    );

    await sleep(150);
    await replicaB.monitor.tickOnce();
    let row = (await replicaB.store.getById(inserted.id))!;
    expect(row.status).toBe('submitted');

    await mine(providerB);
    await replicaB.monitor.tickOnce();
    row = (await replicaB.store.getById(inserted.id))!;
    expect(row.status).toBe('confirmed');
  });
});

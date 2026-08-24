import { Pool } from 'pg';
import { PgTxPoolStore } from '../src/store';
import { NewPoolTx } from '../src/types';
import { runMigrations } from './migrate';
import './anvil'; // global type declarations

const SIGNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const CHAIN = 31337n;

const newTx = (): NewPoolTx => ({
  signerAddress: SIGNER,
  chainId: CHAIN,
  txRequest: { to: SIGNER, value: '12345678901234567890', maxFeePerGas: '2000000000' },
});

describe('PgTxPoolStore', () => {
  let container: { connectionString: string, cleanup: () => Promise<void> };
  let pool: Pool;
  let store: PgTxPoolStore;

  beforeEach(async () => {
    container = await global.startPostgresContainer();
    const goosePath = await global.whichGoose();
    await runMigrations(goosePath, container.connectionString);
    pool = new Pool({ connectionString: container.connectionString });
    store = new PgTxPoolStore(pool);
  });

  afterEach(async () => {
    await pool.end();
    await container.cleanup();
  });

  test('allocateAndInsert initializes counter once and allocates sequentially', async () => {
    let initCalls = 0;
    const init = async () => { initCalls += 1; return 7; };
    const a = await store.allocateAndInsert(newTx(), null, init);
    const b = await store.allocateAndInsert(newTx(), null, init);
    expect(initCalls).toBe(1);
    expect(a.nonce).toBe(7);
    expect(b.nonce).toBe(8);
    expect(a.status).toBe('pending');
    expect(a.txRequest.value).toBe('12345678901234567890');
    expect(a.chainId).toBe(CHAIN);
  });

  test('concurrent allocations get distinct sequential nonces', async () => {
    const rows = await Promise.all(Array.from({ length: 8 }, () => store.allocateAndInsert(newTx(), null, async () => 0)));
    expect(rows.map((r) => r.nonce).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('explicit nonce pins and advances counter; duplicate active nonce rejected', async () => {
    const a = await store.allocateAndInsert(newTx(), 10, async () => 0);
    expect(a.nonce).toBe(10);
    await expect(store.allocateAndInsert(newTx(), 10, async () => 0)).rejects.toThrow(/Active tx already exists/);
    const b = await store.allocateAndInsert(newTx(), null, async () => 0);
    expect(b.nonce).toBe(11);
  });

  test('terminal row frees its nonce (partial unique index)', async () => {
    const a = await store.allocateAndInsert(newTx(), 5, async () => 0);
    await store.markFailed(a.id, 'boom');
    const b = await store.allocateAndInsert(newTx(), 5, async () => 0);
    expect(b.nonce).toBe(5);
    const failed = (await store.getById(a.id))!;
    expect(failed.status).toBe('failed');
    expect(failed.lastError).toBe('boom');
  });

  test('resyncNonce takes max of chain nonce and active rows', async () => {
    await store.allocateAndInsert(newTx(), 5, async () => 0);
    await store.resyncNonce(SIGNER, CHAIN, 3);
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    expect(a.nonce).toBe(6);
    await store.resyncNonce(SIGNER, CHAIN, 20);
    const b = await store.allocateAndInsert(newTx(), null, async () => 0);
    expect(b.nonce).toBe(20);
  });

  test('markSubmitted / markCancelling append attempts', async () => {
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    await store.markSubmitted(a.id, { hash: '0x01', maxFeePerGas: '100', maxPriorityFeePerGas: '10', submittedAt: new Date().toISOString() });
    await store.markSubmitted(a.id, { hash: '0x02', maxFeePerGas: '113', maxPriorityFeePerGas: '12', submittedAt: new Date().toISOString() });
    await store.markCancelling(a.id, { hash: '0x03', maxFeePerGas: '128', submittedAt: new Date().toISOString() });
    const row = (await store.getById(a.id))!;
    expect(row.status).toBe('cancelling');
    expect(row.attemptCount).toBe(3);
    expect(row.latestHash).toBe('0x03');
    expect(row.attempts.map((x) => x.hash)).toEqual(['0x01', '0x02', '0x03']);
    expect(row.attempts[2].cancel).toBe(true);
    expect(row.submittedAt).not.toBeNull();
  });

  test('terminal transitions persist receipt and clear lease', async () => {
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    await store.markSubmitted(a.id, { hash: '0x01', submittedAt: new Date().toISOString() });
    await store.claimActive(SIGNER, CHAIN, 10, 60_000);
    await store.markConfirmed(a.id, { blockNumber: 12, status: 1 });
    const row = (await store.getById(a.id))!;
    expect(row.status).toBe('confirmed');
    expect(row.receipt).toEqual({ blockNumber: 12, status: 1 });
    expect(row.claimedUntil).toBeNull();
  });

  test('claimActive: leases, respects limit, ordered by nonce, ignores pending/terminal', async () => {
    const rows = await Promise.all([0, 1, 2, 3].map((n) => store.allocateAndInsert(newTx(), n, async () => 0)));
    await store.markSubmitted(rows[1].id, { hash: '0xb', submittedAt: new Date().toISOString() });
    await store.markSubmitted(rows[0].id, { hash: '0xa', submittedAt: new Date().toISOString() });
    await store.markSubmitted(rows[2].id, { hash: '0xc', submittedAt: new Date().toISOString() });
    await store.markConfirmed(rows[2].id, { status: 1 });
    // rows[3] stays pending

    const first = await store.claimActive(SIGNER, CHAIN, 1, 60_000);
    expect(first.map((r) => r.nonce)).toEqual([0]);
    const second = await store.claimActive(SIGNER, CHAIN, 10, 60_000);
    expect(second.map((r) => r.nonce)).toEqual([1]);
    expect(await store.claimActive(SIGNER, CHAIN, 10, 60_000)).toEqual([]);

    await store.releaseClaim(rows[0].id);
    const again = await store.claimActive(SIGNER, CHAIN, 10, 60_000);
    expect(again.map((r) => r.nonce)).toEqual([0]);
  });

  test('expired lease is re-claimable', async () => {
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    await store.markSubmitted(a.id, { hash: '0x01', submittedAt: new Date().toISOString() });
    await store.claimActive(SIGNER, CHAIN, 10, 50);
    await new Promise((r) => { setTimeout(r, 100); });
    const again = await store.claimActive(SIGNER, CHAIN, 10, 60_000);
    expect(again.map((r) => r.id)).toEqual([a.id]);
  });

  test('two concurrent claimers receive disjoint sets', async () => {
    const rows = await Promise.all(Array.from({ length: 10 }, (_, n) => store.allocateAndInsert(newTx(), n, async () => 0)));
    await Promise.all(rows.map((r) => store.markSubmitted(r.id, { hash: `0x0${r.nonce}`, submittedAt: new Date().toISOString() })));

    const storeB = new PgTxPoolStore(pool);
    const [a, b] = await Promise.all([
      store.claimActive(SIGNER, CHAIN, 10, 60_000),
      storeB.claimActive(SIGNER, CHAIN, 10, 60_000),
    ]);
    const idsA = a.map((r) => r.id);
    const idsB = b.map((r) => r.id);
    expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
    expect(idsA.length + idsB.length).toBe(10);
  });

  test('claimStalePending claims only old pending rows', async () => {
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    expect(await store.claimStalePending(SIGNER, CHAIN, 500, 60_000)).toEqual([]);
    await new Promise((r) => { setTimeout(r, 600); });
    const claimed = await store.claimStalePending(SIGNER, CHAIN, 500, 60_000);
    expect(claimed.map((r) => r.id)).toEqual([a.id]);
  });

  test('findByHash matches latest and historical attempt hashes', async () => {
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    await store.markSubmitted(a.id, { hash: '0x01', submittedAt: new Date().toISOString() });
    await store.markSubmitted(a.id, { hash: '0x02', submittedAt: new Date().toISOString() });
    expect((await store.findByHash('0x01'))?.id).toBe(a.id);
    expect((await store.findByHash('0x02'))?.id).toBe(a.id);
    expect(await store.findByHash('0xff')).toBeUndefined();
  });

  test('recordError keeps status', async () => {
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    await store.markSubmitted(a.id, { hash: '0x01', submittedAt: new Date().toISOString() });
    await store.recordError(a.id, 'rpc hiccup');
    const row = (await store.getById(a.id))!;
    expect(row.status).toBe('submitted');
    expect(row.lastError).toBe('rpc hiccup');
  });
});

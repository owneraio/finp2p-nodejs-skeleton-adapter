import { InMemoryTxPoolStore } from '../src/store';
import { NewPoolTx } from '../src/types';

const SIGNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const CHAIN = 31337n;

const newTx = (): NewPoolTx => ({
  signerAddress: SIGNER,
  chainId: CHAIN,
  txRequest: { to: SIGNER, value: '1' },
});

describe('InMemoryTxPoolStore', () => {
  test('allocates sequential nonces starting from initNonce', async () => {
    const store = new InMemoryTxPoolStore();
    const a = await store.allocateAndInsert(newTx(), null, async () => 7);
    const b = await store.allocateAndInsert(newTx(), null, async () => 999);
    expect(a.nonce).toBe(7);
    expect(b.nonce).toBe(8);
    expect(a.status).toBe('pending');
  });

  test('concurrent allocations get distinct nonces', async () => {
    const store = new InMemoryTxPoolStore();
    const rows = await Promise.all(Array.from({ length: 5 }, () => store.allocateAndInsert(newTx(), null, async () => 0)));
    expect(rows.map((r) => r.nonce).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
  });

  test('explicit nonce pins and advances the counter past it', async () => {
    const store = new InMemoryTxPoolStore();
    const a = await store.allocateAndInsert(newTx(), 10, async () => 0);
    const b = await store.allocateAndInsert(newTx(), null, async () => 0);
    expect(a.nonce).toBe(10);
    expect(b.nonce).toBe(11);
  });

  test('rejects duplicate active nonce', async () => {
    const store = new InMemoryTxPoolStore();
    await store.allocateAndInsert(newTx(), 5, async () => 0);
    await expect(store.allocateAndInsert(newTx(), 5, async () => 0)).rejects.toThrow(/Active tx already exists/);
  });

  test('terminal row frees the nonce for reuse', async () => {
    const store = new InMemoryTxPoolStore();
    const a = await store.allocateAndInsert(newTx(), 5, async () => 0);
    await store.markFailed(a.id, 'boom');
    const b = await store.allocateAndInsert(newTx(), 5, async () => 0);
    expect(b.nonce).toBe(5);
  });

  test('resyncNonce takes max of chain nonce and active rows', async () => {
    const store = new InMemoryTxPoolStore();
    await store.allocateAndInsert(newTx(), 5, async () => 0);
    await store.resyncNonce(SIGNER, CHAIN, 3);
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    expect(a.nonce).toBe(6); // max(3, 5+1)

    await store.resyncNonce(SIGNER, CHAIN, 20);
    const b = await store.allocateAndInsert(newTx(), null, async () => 0);
    expect(b.nonce).toBe(20);
  });

  test('markSubmitted appends attempts and tracks latest hash', async () => {
    const store = new InMemoryTxPoolStore();
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    await store.markSubmitted(a.id, { hash: '0x01', maxFeePerGas: '100', submittedAt: new Date().toISOString() });
    await store.markSubmitted(a.id, { hash: '0x02', maxFeePerGas: '113', submittedAt: new Date().toISOString() });
    const row = (await store.getById(a.id))!;
    expect(row.status).toBe('submitted');
    expect(row.attemptCount).toBe(2);
    expect(row.latestHash).toBe('0x02');
    expect(row.attempts.map((x) => x.hash)).toEqual(['0x01', '0x02']);
    expect(row.submittedAt).not.toBeNull();
  });

  test('claimActive claims only unleased submitted/cancelling rows and respects limit', async () => {
    const store = new InMemoryTxPoolStore();
    const rows = await Promise.all([0, 1, 2].map((n) => store.allocateAndInsert(newTx(), n, async () => 0)));
    await store.markSubmitted(rows[0].id, { hash: '0xa', submittedAt: new Date().toISOString() });
    await store.markSubmitted(rows[1].id, { hash: '0xb', submittedAt: new Date().toISOString() });
    // rows[2] stays 'pending' — not claimable by claimActive

    const first = await store.claimActive(SIGNER, CHAIN, 1, 60_000);
    expect(first.map((r) => r.id)).toEqual([rows[0].id]);

    const second = await store.claimActive(SIGNER, CHAIN, 10, 60_000);
    expect(second.map((r) => r.id)).toEqual([rows[1].id]); // rows[0] leased

    await store.releaseClaim(rows[0].id);
    const third = await store.claimActive(SIGNER, CHAIN, 10, 60_000);
    expect(third.map((r) => r.id)).toEqual([rows[0].id]);
  });

  test('expired lease is re-claimable', async () => {
    const store = new InMemoryTxPoolStore();
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    await store.markSubmitted(a.id, { hash: '0xa', submittedAt: new Date().toISOString() });
    await store.claimActive(SIGNER, CHAIN, 10, 10);
    await new Promise((r) => { setTimeout(r, 30); });
    const again = await store.claimActive(SIGNER, CHAIN, 10, 60_000);
    expect(again.map((r) => r.id)).toEqual([a.id]);
  });

  test('claimStalePending claims only old pending rows', async () => {
    const store = new InMemoryTxPoolStore();
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    expect(await store.claimStalePending(SIGNER, CHAIN, 50, 60_000)).toEqual([]);
    await new Promise((r) => { setTimeout(r, 80); });
    const claimed = await store.claimStalePending(SIGNER, CHAIN, 50, 60_000);
    expect(claimed.map((r) => r.id)).toEqual([a.id]);
  });

  test('findByHash matches any attempt hash', async () => {
    const store = new InMemoryTxPoolStore();
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    await store.markSubmitted(a.id, { hash: '0x01', submittedAt: new Date().toISOString() });
    await store.markSubmitted(a.id, { hash: '0x02', submittedAt: new Date().toISOString() });
    expect((await store.findByHash('0x01'))?.id).toBe(a.id);
    expect((await store.findByHash('0x02'))?.id).toBe(a.id);
    expect(await store.findByHash('0xff')).toBeUndefined();
  });

  test('markCancelling flags the attempt and status', async () => {
    const store = new InMemoryTxPoolStore();
    const a = await store.allocateAndInsert(newTx(), null, async () => 0);
    await store.markSubmitted(a.id, { hash: '0x01', submittedAt: new Date().toISOString() });
    await store.markCancelling(a.id, { hash: '0x02', submittedAt: new Date().toISOString() });
    const row = (await store.getById(a.id))!;
    expect(row.status).toBe('cancelling');
    expect(row.attempts[1].cancel).toBe(true);
  });
});

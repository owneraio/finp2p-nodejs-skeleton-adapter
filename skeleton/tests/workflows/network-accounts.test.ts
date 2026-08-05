import { migrateIfNeeded } from '../../src/workflows'
import { PgNetworkAccountStore } from '../../src/storage'
import { NetworkAccountServiceImpl } from '../../src/services/accounts'
import { networkAccountFromAPI, bindInfoOptFromAPI } from '../../src/routes/mapping'
import { AccountInvalidShapeError } from '../../src/models'
import { Pool } from 'pg'

describe("network accounts", () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let pool: Pool;
  let store: PgNetworkAccountStore;
  let service: NetworkAccountServiceImpl;

  const ORG = "bank-x";
  const ASSET = "bank-x:102:asset-1";
  const FIN = "02a1b2c3";
  const wallet = (address: string) => ({ type: 'walletAccount' as const, address });

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations",
      storageUser: container.storageUser,
    })
    pool = new Pool({ connectionString: container.connectionString });
    store = new PgNetworkAccountStore(pool);
    service = new NetworkAccountServiceImpl(store);
  })

  afterEach(async () => {
    await pool.end();
    await container.cleanup();
  });

  test("bind records the account and returns an id", async () => {
    const op = await service.createAccount("ik-1", ORG, ASSET, FIN, { account: wallet("0xAAA") });

    if (op.type !== 'success') throw new Error(`expected success, got ${op.type}`);
    expect(op.record.id).toBeTruthy();
    expect(op.record.account).toEqual(wallet("0xAAA"));

    const row = await store.getByFinId(ORG, ASSET, FIN);
    expect(row?.account).toEqual(wallet("0xAAA"));
  });

  // The interface doc promises a repeat create replays the recorded binding.
  // Nothing enforced that before, and the wallet in the second request is
  // deliberately different to prove the stored one wins rather than being
  // overwritten or duplicated.
  test("repeat create replays the existing binding, ignoring a different wallet", async () => {
    const first = await service.createAccount("ik-1", ORG, ASSET, FIN, { account: wallet("0xAAA") });
    const second = await service.createAccount("ik-2", ORG, ASSET, FIN, { account: wallet("0xBBB") });

    if (first.type !== 'success' || second.type !== 'success') throw new Error("expected success");
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.account).toEqual(wallet("0xAAA"));

    const row = await store.getByFinId(ORG, ASSET, FIN);
    expect(row?.account).toEqual(wallet("0xAAA"));
  });

  // Two concurrent creates for the same (org, asset, finId) must not race the
  // unique index into a 23505. Both should observe the same winning row.
  test("concurrent creates for the same triple converge on one binding", async () => {
    const [a, b] = await Promise.all([
      service.createAccount("ik-a", ORG, ASSET, FIN, { account: wallet("0xAAA") }),
      service.createAccount("ik-b", ORG, ASSET, FIN, { account: wallet("0xBBB") }),
    ]);

    if (a.type !== 'success' || b.type !== 'success') throw new Error("expected success");
    expect(a.record.id).toBe(b.record.id);

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM ledger_adapter.network_accounts WHERE fin_id = $1", [FIN],
    );
    expect(rows[0].n).toBe(1);
  });

  test("the same wallet may be bound for different investors (omnibus)", async () => {
    const a = await service.createAccount("ik-1", ORG, ASSET, "02aaaa", { account: wallet("0xSHARED") });
    const b = await service.createAccount("ik-2", ORG, ASSET, "02bbbb", { account: wallet("0xSHARED") });

    if (a.type !== 'success' || b.type !== 'success') throw new Error("expected success");
    expect(a.record.id).not.toBe(b.record.id);
  });

  test("one binding per investor per (org, asset), but assets are independent", async () => {
    await service.createAccount("ik-1", ORG, ASSET, FIN, { account: wallet("0xAAA") });
    await service.createAccount("ik-2", ORG, "bank-x:102:asset-2", FIN, { account: wallet("0xCCC") });

    expect((await store.getByFinId(ORG, ASSET, FIN))?.account).toEqual(wallet("0xAAA"));
    expect((await store.getByFinId(ORG, "bank-x:102:asset-2", FIN))?.account).toEqual(wallet("0xCCC"));
  });

  test("remove deletes the binding", async () => {
    const op = await service.createAccount("ik-1", ORG, ASSET, FIN, { account: wallet("0xAAA") });
    if (op.type !== 'success') throw new Error("expected success");

    await service.removeAccount("ik-2", op.record.id);
    expect(await store.getByFinId(ORG, ASSET, FIN)).toBeUndefined();
  });

  // Removing something absent is a success so router retries don't fail.
  test("remove of an absent account is a success", async () => {
    const removed = await service.removeAccount("ik-1", "no-such-account");
    if (removed.type !== 'success') throw new Error(`expected success, got ${removed.type}`);
    expect(removed.record.account).toEqual({ type: 'none' });
  });

  describe("account type mapping", () => {
    test("walletAccount maps through", () => {
      expect(networkAccountFromAPI({ type: 'walletAccount', address: '0xAAA' }))
        .toEqual(wallet('0xAAA'));
    });

    test("the empty object is noneAccount", () => {
      expect(networkAccountFromAPI({})).toEqual({ type: 'none' });
    });

    // Regression: these used to fall through to { type: 'none' }, so a bind
    // reported success while recording an empty account — and every later
    // operation naming the real account failed 7351 AccountNotWhitelisted with
    // nothing at bind time to explain it.
    test("caip10Account is rejected, not degraded to none", () => {
      expect(() => networkAccountFromAPI(
        { type: 'caip10Account', network: 'eip155:1', address: '0xAAA' },
      )).toThrow(AccountInvalidShapeError);
    });

    test("custodialAccount is rejected, not degraded to none", () => {
      expect(() => networkAccountFromAPI(
        { type: 'custodialAccount', provider: 'fireblocks', vaultAccountId: 'v7' },
      )).toThrow(AccountInvalidShapeError);
    });

    // The router sends a bare hex hint with no template; it used to be dropped.
    test("the raw ownership hint survives mapping", () => {
      const bindInfo = bindInfoOptFromAPI({
        networkAccount: { type: 'walletAccount', address: '0xAAA' },
        ownershipSignature: { signature: 'deadbeef' },
      } as any);
      expect(bindInfo?.ownershipSignature).toBe('deadbeef');
    });

    test("an absent hint stays absent", () => {
      const bindInfo = bindInfoOptFromAPI({
        networkAccount: { type: 'walletAccount', address: '0xAAA' },
      } as any);
      expect(bindInfo?.ownershipSignature).toBeUndefined();
    });
  });
});

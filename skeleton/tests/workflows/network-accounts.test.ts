import { migrateIfNeeded } from '../../src/workflows'
import { PgNetworkAccountStore } from '../../src/storage'
import { NetworkAccountServiceImpl } from '../../src/services/accounts'
import {
  networkAccountFromAPI, networkAccountToAPI, bindInfoOptFromAPI,
  sourceFromAPI, destinationFromAPI, receiptToAPI,
} from '../../src/routes/mapping'
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
      schemaName: "ledger_adapter",
    })
    pool = new Pool({ connectionString: container.connectionString });
    store = new PgNetworkAccountStore(pool, "ledger_adapter");
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

  test("repeat create replays the existing binding, ignoring a different wallet", async () => {
    const first = await service.createAccount("ik-1", ORG, ASSET, FIN, { account: wallet("0xAAA") });
    const second = await service.createAccount("ik-2", ORG, ASSET, FIN, { account: wallet("0xBBB") });

    if (first.type !== 'success' || second.type !== 'success') throw new Error("expected success");
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.account).toEqual(wallet("0xAAA"));

    const row = await store.getByFinId(ORG, ASSET, FIN);
    expect(row?.account).toEqual(wallet("0xAAA"));
  });

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

    test("caip10Account round-trips", () => {
      const api = { type: 'caip10Account' as const, network: 'eip155:1', address: '0xAAA' };
      const domain = networkAccountFromAPI(api);
      expect(domain).toEqual(api);
      expect(networkAccountToAPI(domain)).toEqual(api);
    });

    test("custodialAccount round-trips, with no address", () => {
      const api = { type: 'custodialAccount' as const, provider: 'fireblocks', vaultAccountId: 'v7' };
      const domain = networkAccountFromAPI(api);
      expect(domain).toEqual(api);
      expect(domain).not.toHaveProperty('address');
      expect(networkAccountToAPI(domain)).toEqual(api);
    });

    test("custodialAccount carries the optional assetId when present", () => {
      const api = {
        type: 'custodialAccount' as const, provider: 'fireblocks', vaultAccountId: 'v7', assetId: 'ETH',
      };
      expect(networkAccountToAPI(networkAccountFromAPI(api))).toEqual(api);
    });

    test("an absent assetId is not materialized as undefined", () => {
      const domain = networkAccountFromAPI(
        { type: 'custodialAccount', provider: 'fireblocks', vaultAccountId: 'v7' },
      );
      expect(Object.keys(domain).sort()).toEqual(['provider', 'type', 'vaultAccountId']);
    });

    test("an unknown type is rejected, not degraded to none", () => {
      expect(() => networkAccountFromAPI(
        { type: 'martianAccount', address: '0xAAA' } as any,
      )).toThrow(AccountInvalidShapeError);
    });

    test("all bound variants persist and read back", async () => {
      const variants = [
        { type: 'walletAccount' as const, address: '0xAAA' },
        { type: 'caip10Account' as const, network: 'eip155:1', address: '0xBBB' },
        { type: 'custodialAccount' as const, provider: 'fireblocks', vaultAccountId: 'v7' },
      ];
      for (const [i, account] of variants.entries()) {
        const fin = `02fin${i}`;
        const op = await service.createAccount(`ik-${i}`, ORG, ASSET, fin, { account });
        if (op.type !== 'success') throw new Error(`expected success for ${account.type}`);
        expect(op.record.account).toEqual(account);
        expect((await store.getByFinId(ORG, ASSET, fin))?.account).toEqual(account);
      }
    });
  });

  // A custodial leg used to throw inside sourceFromAPI/destinationFromAPI,
  // failing the operation itself — not just onboarding.
  describe("operation leg account mapping", () => {
    const legs = [
      { type: 'walletAccount' as const, address: '0xAAA' },
      { type: 'caip10Account' as const, network: 'eip155:1', address: '0xBBB' },
      { type: 'custodialAccount' as const, provider: 'fireblocks', vaultAccountId: 'v7' },
    ];

    test.each(legs.map((l) => [l.type, l] as const))("%s survives a source leg", (_t, ledgerAccount) => {
      const source = sourceFromAPI({ finId: 'fin-1', ledgerAccount } as any);
      expect(source.account).toEqual(ledgerAccount);
    });

    test.each(legs.map((l) => [l.type, l] as const))("%s survives a destination leg", (_t, ledgerAccount) => {
      const destination = destinationFromAPI({ finId: 'fin-1', ledgerAccount } as any);
      expect(destination.account).toEqual(ledgerAccount);
    });

    const receiptWith = (account: any) => ({
      id: 'r-1',
      asset: { assetId: 'a-1', assetType: 'finp2p' as const },
      source: { finId: 'fin-1', account },
      destination: { finId: 'fin-2', account },
      quantity: '1',
      transactionDetails: { transactionId: 'tx-1' },
      tradeDetails: {},
      operationType: 'transfer' as const,
      proof: undefined,
      timestamp: 0,
    });

    test.each(legs.map((l) => [l.type, l] as const))("%s survives a receipt leg", (_t, account) => {
      const receipt = receiptToAPI(receiptWith(account) as any);
      expect(receipt.source?.ledgerAccount).toEqual(account);
      expect(receipt.destination?.ledgerAccount).toEqual(account);
    });

    // A non-canonical discriminator used to throw, then briefly returned
    // undefined — which means "no account", so the receipt shipped with the leg
    // silently missing.
    test("an unknown type throws rather than dropping the account", () => {
      expect(() => receiptToAPI(receiptWith({ type: 'wallet', address: '0xAAA' }) as any))
        .toThrow(/unsupported ledger account type: wallet/);
    });

    test("an absent account stays absent", () => {
      const receipt = receiptToAPI(receiptWith(undefined) as any);
      expect(receipt.source?.ledgerAccount).toBeUndefined();
    });

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

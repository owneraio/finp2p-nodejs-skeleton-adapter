import { migrateIfNeeded } from '../../src/workflows'
import { PgInvestorWhitelistStore } from '../../src/storage'
import { InvestorWhitelistServiceImpl } from '../../src/services/whitelist'
import { ValidationError } from '../../src/models'
import { Pool } from 'pg'

describe("investor whitelist", () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let pool: Pool;
  let store: PgInvestorWhitelistStore;
  let service: InvestorWhitelistServiceImpl;

  const FIN = "02a1b2c3";
  const ASSET = "bank-x:102:asset-1";

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
    store = new PgInvestorWhitelistStore(pool);
    service = new InvestorWhitelistServiceImpl(store);
  })

  afterEach(async () => {
    await pool.end();
    await container.cleanup();
  });

  test("whitelist records the entry and reports membership", async () => {
    const entry = await service.whitelist(FIN, ASSET, { tier: 'A', maxNotional: 1000 });

    expect(entry).toEqual({ finId: FIN, assetId: ASSET, config: { tier: 'A', maxNotional: 1000 } });
    expect(await service.isWhitelisted(FIN, ASSET)).toBe(true);
    expect(await service.isWhitelisted(FIN, "bank-x:102:other")).toBe(false);
  });

  test("arbitrary nested config survives a round trip", async () => {
    const config = {
      tier: 'A',
      limits: { daily: 10, currencies: ['USD', 'EUR'] },
      enabled: true,
      ratio: 1.5,
      nothing: null,
    };
    await service.whitelist(FIN, ASSET, config);
    const [entry] = await service.getWhitelist(FIN, ASSET);
    expect(entry.config).toEqual(config);
  });

  test("an empty config is allowed", async () => {
    const entry = await service.whitelist(FIN, ASSET, {});
    expect(entry.config).toEqual({});
    expect(await service.isWhitelisted(FIN, ASSET)).toBe(true);
  });

  test("re-whitelisting replaces the config rather than duplicating", async () => {
    await service.whitelist(FIN, ASSET, { tier: 'A' });
    await service.whitelist(FIN, ASSET, { tier: 'B' });

    const entries = await service.getWhitelist(FIN, ASSET);
    expect(entries).toHaveLength(1);
    expect(entries[0].config).toEqual({ tier: 'B' });
  });

  test("concurrent whitelists for the same pair converge on one row", async () => {
    await Promise.all([
      service.whitelist(FIN, ASSET, { tier: 'A' }),
      service.whitelist(FIN, ASSET, { tier: 'B' }),
    ]);
    expect(await service.getWhitelist(FIN, ASSET)).toHaveLength(1);
  });

  test("entries are per asset and per investor", async () => {
    await service.whitelist(FIN, ASSET, { tier: 'A' });
    await service.whitelist(FIN, "bank-x:102:asset-2", { tier: 'B' });
    await service.whitelist("02ffff", ASSET, { tier: 'C' });

    expect(await service.getWhitelist(FIN)).toHaveLength(2);
    expect(await service.getWhitelist(undefined, ASSET)).toHaveLength(2);
    expect(await service.getWhitelist()).toHaveLength(3);
  });

  test("dewhitelist removes one pair and reports the count", async () => {
    await service.whitelist(FIN, ASSET, {});
    await service.whitelist(FIN, "bank-x:102:asset-2", {});

    expect(await service.dewhitelist(FIN, ASSET)).toBe(1);
    expect(await service.isWhitelisted(FIN, ASSET)).toBe(false);
    expect(await service.isWhitelisted(FIN, "bank-x:102:asset-2")).toBe(true);
  });

  test("dewhitelist without an assetId removes every entry for the investor", async () => {
    await service.whitelist(FIN, ASSET, {});
    await service.whitelist(FIN, "bank-x:102:asset-2", {});
    await service.whitelist("02ffff", ASSET, {});

    expect(await service.dewhitelist(FIN)).toBe(2);
    expect(await service.getWhitelist(FIN)).toHaveLength(0);
    expect(await service.isWhitelisted("02ffff", ASSET)).toBe(true);
  });

  test("dewhitelisting something absent is a success returning 0", async () => {
    expect(await service.dewhitelist("02nope", ASSET)).toBe(0);
    expect(await service.dewhitelist("02nope")).toBe(0);
  });

  describe("validator hook", () => {
    test("the returned config is what gets stored", async () => {
      const normalizing = new InvestorWhitelistServiceImpl(store, {
        validate: async (_f, _a, config) => ({ ...config, normalized: true }),
      });
      const entry = await normalizing.whitelist(FIN, ASSET, { tier: 'a' });
      expect(entry.config).toEqual({ tier: 'a', normalized: true });
      expect((await store.get(FIN, ASSET))?.config).toEqual({ tier: 'a', normalized: true });
    });

    test("a throwing validator rejects the entry and stores nothing", async () => {
      const rejecting = new InvestorWhitelistServiceImpl(store, {
        validate: async () => { throw new ValidationError('nope'); },
      });
      await expect(rejecting.whitelist(FIN, ASSET, {})).rejects.toThrow(ValidationError);
      expect(await service.isWhitelisted(FIN, ASSET)).toBe(false);
    });
  });
});

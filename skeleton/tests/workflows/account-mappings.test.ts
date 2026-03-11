import * as workflows from '../../src/workflows'

describe("account mappings", () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let storage: workflows.Storage;

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await workflows.migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: "finp2p_nodejs_skeleton_migrations",
      storageUser: container.storageUser,
    })
    storage = new workflows.Storage(container)
  })

  afterEach(async () => {
    await storage.closeConnections();
    await container.cleanup();
  });

  test("save and retrieve mapping by finId", async () => {
    const saved = await workflows.saveAccountMapping("fin-1", "0xABC123");
    expect(saved.fin_id).toBe("fin-1");
    expect(saved.account).toBe("0xabc123");
    expect(saved.created_at).toBeDefined();

    const mappings = await workflows.getAccountMappings(["fin-1"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].account).toBe("0xabc123");
  });

  test("multiple accounts per finId", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAAA");
    await workflows.saveAccountMapping("fin-1", "0xBBB");

    const mappings = await workflows.getAccountMappings(["fin-1"]);
    expect(mappings).toHaveLength(2);
    expect(mappings.map(m => m.account).sort()).toEqual(["0xaaa", "0xbbb"]);
  });

  test("duplicate insert is idempotent", async () => {
    const first = await workflows.saveAccountMapping("fin-1", "0xAAA");
    const second = await workflows.saveAccountMapping("fin-1", "0xAAA");

    expect(second.fin_id).toBe(first.fin_id);
    expect(second.account).toBe(first.account);

    const all = await workflows.getAccountMappings();
    expect(all).toHaveLength(1);
  });

  test("retrieve mappings by account (case-insensitive input)", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAbCdEf");
    await workflows.saveAccountMapping("fin-2", "0xABCDEF");

    // Both stored as lowercase, so they are the same account — idempotent
    const all = await workflows.getAccountMappings();
    expect(all).toHaveLength(2);

    // Querying with any casing finds them
    const byAccount = await workflows.getAccountMappingsByAccount("0xABCDEF");
    expect(byAccount).toHaveLength(2);
    expect(byAccount.map(m => m.fin_id).sort()).toEqual(["fin-1", "fin-2"]);
  });

  test("delete specific mapping", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAAA");
    await workflows.saveAccountMapping("fin-1", "0xBBB");

    await workflows.deleteAccountMapping("fin-1", "0xAAA");

    const mappings = await workflows.getAccountMappings(["fin-1"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].account).toBe("0xbbb");
  });

  test("delete with different casing still matches", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAbC");
    await workflows.deleteAccountMapping("fin-1", "0xABC");

    const mappings = await workflows.getAccountMappings(["fin-1"]);
    expect(mappings).toHaveLength(0);
  });

  test("delete all mappings for finId", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAAA");
    await workflows.saveAccountMapping("fin-1", "0xBBB");

    await workflows.deleteAccountMapping("fin-1");

    const mappings = await workflows.getAccountMappings(["fin-1"]);
    expect(mappings).toHaveLength(0);
  });

  test("list all mappings", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAAA");
    await workflows.saveAccountMapping("fin-2", "0xBBB");
    await workflows.saveAccountMapping("fin-3", "0xCCC");

    const all = await workflows.getAccountMappings();
    expect(all).toHaveLength(3);
  });

  test("getAccountMappings returns oldest mapping first", async () => {
    await workflows.saveAccountMapping("fin-order", "0xfirst");
    // Insert a second row with a slightly later timestamp
    await workflows.saveAccountMapping("fin-order", "0xsecond");

    const mappings = await workflows.getAccountMappings(["fin-order"]);
    expect(mappings).toHaveLength(2);
    expect(mappings[0].account).toBe("0xfirst");
    expect(mappings[1].account).toBe("0xsecond");
  });

  test("getAccountMappingsByAccount returns oldest mapping first", async () => {
    await workflows.saveAccountMapping("fin-a", "0xshared");
    await workflows.saveAccountMapping("fin-b", "0xshared");

    const mappings = await workflows.getAccountMappingsByAccount("0xSHARED");
    expect(mappings).toHaveLength(2);
    expect(mappings[0].fin_id).toBe("fin-a");
    expect(mappings[1].fin_id).toBe("fin-b");
  });

  test("secondary sort is stable when timestamps are equal", async () => {
    // Insert two rows in a single transaction so created_at is identical
    const pool = (storage as any).c;
    await pool.query(`
      INSERT INTO ledger_adapter.account_mappings (fin_id, account, created_at)
      VALUES ('fin-tie', '0xzzz', NOW()), ('fin-tie', '0xaaa', NOW())
    `);

    const mappings = await workflows.getAccountMappings(["fin-tie"]);
    expect(mappings).toHaveLength(2);
    // Secondary sort by account ASC: 0xaaa < 0xzzz
    expect(mappings[0].account).toBe("0xaaa");
    expect(mappings[1].account).toBe("0xzzz");
  });

  test("empty result for nonexistent finId", async () => {
    const mappings = await workflows.getAccountMappings(["does-not-exist"]);
    expect(mappings).toHaveLength(0);
  });
});

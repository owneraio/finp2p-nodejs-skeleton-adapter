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
    expect(saved.account).toBe("0xABC123");
    expect(saved.created_at).toBeDefined();

    const mappings = await workflows.getAccountMappings("fin-1");
    expect(mappings).toHaveLength(1);
    expect(mappings[0].account).toBe("0xABC123");
  });

  test("multiple accounts per finId", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAAA");
    await workflows.saveAccountMapping("fin-1", "0xBBB");

    const mappings = await workflows.getAccountMappings("fin-1");
    expect(mappings).toHaveLength(2);
    expect(mappings.map(m => m.account).sort()).toEqual(["0xAAA", "0xBBB"]);
  });

  test("duplicate insert is idempotent", async () => {
    const first = await workflows.saveAccountMapping("fin-1", "0xAAA");
    const second = await workflows.saveAccountMapping("fin-1", "0xAAA");

    expect(second.fin_id).toBe(first.fin_id);
    expect(second.account).toBe(first.account);

    const all = await workflows.listAccountMappings();
    expect(all).toHaveLength(1);
  });

  test("retrieve mappings by account (case-insensitive)", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAbCdEf");
    await workflows.saveAccountMapping("fin-2", "0xABCDEF");

    const byAccount = await workflows.getAccountMappingsByAccount("0xabcdef");
    expect(byAccount).toHaveLength(2);
    expect(byAccount.map(m => m.fin_id).sort()).toEqual(["fin-1", "fin-2"]);
  });

  test("delete specific mapping", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAAA");
    await workflows.saveAccountMapping("fin-1", "0xBBB");

    await workflows.deleteAccountMapping("fin-1", "0xAAA");

    const mappings = await workflows.getAccountMappings("fin-1");
    expect(mappings).toHaveLength(1);
    expect(mappings[0].account).toBe("0xBBB");
  });

  test("delete all mappings for finId", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAAA");
    await workflows.saveAccountMapping("fin-1", "0xBBB");

    await workflows.deleteAccountMapping("fin-1");

    const mappings = await workflows.getAccountMappings("fin-1");
    expect(mappings).toHaveLength(0);
  });

  test("list all mappings", async () => {
    await workflows.saveAccountMapping("fin-1", "0xAAA");
    await workflows.saveAccountMapping("fin-2", "0xBBB");
    await workflows.saveAccountMapping("fin-3", "0xCCC");

    const all = await workflows.listAccountMappings();
    expect(all).toHaveLength(3);
  });

  test("empty result for nonexistent finId", async () => {
    const mappings = await workflows.getAccountMappings("does-not-exist");
    expect(mappings).toHaveLength(0);
  });
});

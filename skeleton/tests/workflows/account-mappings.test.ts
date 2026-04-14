import { migrateIfNeeded, Storage } from '../../src/workflows'

describe("account mappings", () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let storage: Storage;

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
    storage = new Storage(container)
  })

  afterEach(async () => {
    await storage.closeConnections();
    await container.cleanup();
  });

  test("save and retrieve mapping by finId", async () => {
    const saved = await storage.saveAccountMapping("fin-1", { ledgerAccountId: "0xABC123" });
    expect(saved.finId).toBe("fin-1");
    expect(saved.fields.ledgerAccountId).toBe("0xabc123");

    const mappings = await storage.getAccountMappings(["fin-1"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.ledgerAccountId).toBe("0xabc123");
  });

  test("multiple fields per finId", async () => {
    await storage.saveAccountMapping("fin-1", {
      ledgerAccountId: "0xAAA",
      custodyAccountId: "vault-1",
    });

    const mappings = await storage.getAccountMappings(["fin-1"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.ledgerAccountId).toBe("0xaaa");
    expect(mappings[0].fields.custodyAccountId).toBe("vault-1");
  });

  test("duplicate insert is idempotent", async () => {
    await storage.saveAccountMapping("fin-1", { ledgerAccountId: "0xAAA" });
    await storage.saveAccountMapping("fin-1", { ledgerAccountId: "0xAAA" });

    const all = await storage.getAccountMappings();
    expect(all).toHaveLength(1);
    expect(all[0].fields.ledgerAccountId).toBe("0xaaa");
  });

  test("update existing field value", async () => {
    await storage.saveAccountMapping("fin-1", { ledgerAccountId: "0xOLD" });
    await storage.saveAccountMapping("fin-1", { ledgerAccountId: "0xNEW" });

    const mappings = await storage.getAccountMappings(["fin-1"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.ledgerAccountId).toBe("0xnew");
  });

  test("retrieve mappings by field value (case-insensitive)", async () => {
    await storage.saveAccountMapping("fin-1", { ledgerAccountId: "0xAbCdEf" });
    await storage.saveAccountMapping("fin-2", { ledgerAccountId: "0xABCDEF" });

    const byValue = await storage.getAccountMappingsByFieldValue("ledgerAccountId", "0xABCDEF");
    expect(byValue).toHaveLength(2);
    expect(byValue.map(m => m.finId).sort()).toEqual(["fin-1", "fin-2"]);
  });

  test("delete specific field", async () => {
    await storage.saveAccountMapping("fin-1", {
      ledgerAccountId: "0xAAA",
      custodyAccountId: "vault-1",
    });

    await storage.deleteAccountMapping("fin-1", "ledgerAccountId");

    const mappings = await storage.getAccountMappings(["fin-1"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.custodyAccountId).toBe("vault-1");
    expect(mappings[0].fields.ledgerAccountId).toBeUndefined();
  });

  test("delete all mappings for finId", async () => {
    await storage.saveAccountMapping("fin-1", {
      ledgerAccountId: "0xAAA",
      custodyAccountId: "vault-1",
    });

    await storage.deleteAccountMapping("fin-1");

    const mappings = await storage.getAccountMappings(["fin-1"]);
    expect(mappings).toHaveLength(0);
  });

  test("list all mappings", async () => {
    await storage.saveAccountMapping("fin-1", { ledgerAccountId: "0xAAA" });
    await storage.saveAccountMapping("fin-2", { ledgerAccountId: "0xBBB" });
    await storage.saveAccountMapping("fin-3", { ledgerAccountId: "0xCCC" });

    const all = await storage.getAccountMappings();
    expect(all).toHaveLength(3);
  });

  test("empty result for nonexistent finId", async () => {
    const mappings = await storage.getAccountMappings(["does-not-exist"]);
    expect(mappings).toHaveLength(0);
  });

  test("getAccountMappingsByFieldValue returns all fields for matched finIds", async () => {
    await storage.saveAccountMapping("fin-1", {
      ledgerAccountId: "0xshared",
      custodyAccountId: "vault-a",
    });
    await storage.saveAccountMapping("fin-2", {
      ledgerAccountId: "0xshared",
      custodyAccountId: "vault-b",
    });

    const byValue = await storage.getAccountMappingsByFieldValue("ledgerAccountId", "0xSHARED");
    expect(byValue).toHaveLength(2);
    for (const m of byValue) {
      expect(m.fields.ledgerAccountId).toBe("0xshared");
      expect(m.fields.custodyAccountId).toBeDefined();
    }
  });
});

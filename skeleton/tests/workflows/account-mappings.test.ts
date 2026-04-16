import { migrateIfNeeded } from '../../src/workflows'
import { PgAccountStore } from '../../src/storage'
import { Pool } from 'pg'

describe("account mappings", () => {
  let container: { connectionString: string, storageUser: string, cleanup: () => Promise<void> } = { connectionString: "", storageUser: "", cleanup: () => Promise.resolve() }
  let pool: Pool;
  let store: PgAccountStore;

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
    store = new PgAccountStore(pool);
  })

  afterEach(async () => {
    await pool.end();
    await container.cleanup();
  });

  test("save and retrieve mapping by finId", async () => {
    const saved = await store.saveAccount("fin-1", { ledgerAccountId: "0xABC123" });
    expect(saved.finId).toBe("fin-1");
    expect(saved.fields.ledgerAccountId).toBe("0xabc123");

    const mappings = await store.getAccounts(["fin-1"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.ledgerAccountId).toBe("0xabc123");
  });

  test("multiple fields per finId", async () => {
    await store.saveAccount("fin-1", {
      ledgerAccountId: "0xAAA",
      custodyAccountId: "vault-1",
    });

    const mappings = await store.getAccounts(["fin-1"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.ledgerAccountId).toBe("0xaaa");
    expect(mappings[0].fields.custodyAccountId).toBe("vault-1");
  });

  test("duplicate insert is idempotent", async () => {
    await store.saveAccount("fin-1", { ledgerAccountId: "0xAAA" });
    await store.saveAccount("fin-1", { ledgerAccountId: "0xAAA" });

    const all = await store.getAccounts();
    expect(all).toHaveLength(1);
    expect(all[0].fields.ledgerAccountId).toBe("0xaaa");
  });

  test("update existing field value", async () => {
    await store.saveAccount("fin-1", { ledgerAccountId: "0xOLD" });
    await store.saveAccount("fin-1", { ledgerAccountId: "0xNEW" });

    const mappings = await store.getAccounts(["fin-1"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.ledgerAccountId).toBe("0xnew");
  });

  test("retrieve mappings by field value (case-insensitive)", async () => {
    await store.saveAccount("fin-1", { ledgerAccountId: "0xAbCdEf" });
    await store.saveAccount("fin-2", { ledgerAccountId: "0xABCDEF" });

    const byValue = await store.getByFieldValue("ledgerAccountId", "0xABCDEF");
    expect(byValue).toHaveLength(2);
    expect(byValue.map(m => m.finId).sort()).toEqual(["fin-1", "fin-2"]);
  });

  test("delete specific field", async () => {
    await store.saveAccount("fin-1", {
      ledgerAccountId: "0xAAA",
      custodyAccountId: "vault-1",
    });

    await store.deleteAccount("fin-1", "ledgerAccountId");

    const mappings = await store.getAccounts(["fin-1"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.custodyAccountId).toBe("vault-1");
    expect(mappings[0].fields.ledgerAccountId).toBeUndefined();
  });

  test("delete all mappings for finId", async () => {
    await store.saveAccount("fin-1", {
      ledgerAccountId: "0xAAA",
      custodyAccountId: "vault-1",
    });

    await store.deleteAccount("fin-1");

    const mappings = await store.getAccounts(["fin-1"]);
    expect(mappings).toHaveLength(0);
  });

  test("list all mappings", async () => {
    await store.saveAccount("fin-1", { ledgerAccountId: "0xAAA" });
    await store.saveAccount("fin-2", { ledgerAccountId: "0xBBB" });
    await store.saveAccount("fin-3", { ledgerAccountId: "0xCCC" });

    const all = await store.getAccounts();
    expect(all).toHaveLength(3);
  });

  test("empty result for nonexistent finId", async () => {
    const mappings = await store.getAccounts(["does-not-exist"]);
    expect(mappings).toHaveLength(0);
  });

  test("getByFieldValue returns all fields for matched finIds", async () => {
    await store.saveAccount("fin-1", {
      ledgerAccountId: "0xshared",
      custodyAccountId: "vault-a",
    });
    await store.saveAccount("fin-2", {
      ledgerAccountId: "0xshared",
      custodyAccountId: "vault-b",
    });

    const byValue = await store.getByFieldValue("ledgerAccountId", "0xSHARED");
    expect(byValue).toHaveLength(2);
    for (const m of byValue) {
      expect(m.fields.ledgerAccountId).toBe("0xshared");
      expect(m.fields.custodyAccountId).toBeDefined();
    }
  });
});

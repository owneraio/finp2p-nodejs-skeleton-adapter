import * as workflows from '../../src/workflows'

describe("network mappings", () => {
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

  test("save and retrieve network mapping", async () => {
    const saved = await workflows.saveNetworkMapping("eip155:11155111", {
      chainId: "11155111",
      rpcUrl: "https://sepolia.infura.io/v3/key",
    });
    expect(saved.networkId).toBe("eip155:11155111");
    expect(saved.fields.chainId).toBe("11155111");
    expect(saved.fields.rpcUrl).toBe("https://sepolia.infura.io/v3/key");

    const mappings = await workflows.getNetworkMappings(["eip155:11155111"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.chainId).toBe("11155111");
  });

  test("multiple fields per networkId", async () => {
    await workflows.saveNetworkMapping("eip155:1", {
      chainId: "1",
      rpcUrl: "https://mainnet.infura.io",
      submitMode: "custody-submit",
      finalityConfirmations: "12",
    });

    const mappings = await workflows.getNetworkMappings(["eip155:1"]);
    expect(mappings).toHaveLength(1);
    expect(Object.keys(mappings[0].fields)).toHaveLength(4);
    expect(mappings[0].fields.submitMode).toBe("custody-submit");
  });

  test("upsert overwrites field value", async () => {
    await workflows.saveNetworkMapping("besu:corp", { rpcUrl: "http://old:8545" });
    await workflows.saveNetworkMapping("besu:corp", { rpcUrl: "http://new:8545" });

    const mappings = await workflows.getNetworkMappings(["besu:corp"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.rpcUrl).toBe("http://new:8545");
  });

  test("delete specific field", async () => {
    await workflows.saveNetworkMapping("eip155:5", {
      chainId: "5",
      rpcUrl: "https://goerli.infura.io",
    });

    await workflows.deleteNetworkMapping("eip155:5", "rpcUrl");

    const mappings = await workflows.getNetworkMappings(["eip155:5"]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fields.chainId).toBe("5");
    expect(mappings[0].fields.rpcUrl).toBeUndefined();
  });

  test("delete all fields for networkId", async () => {
    await workflows.saveNetworkMapping("eip155:5", {
      chainId: "5",
      rpcUrl: "https://goerli.infura.io",
    });

    await workflows.deleteNetworkMapping("eip155:5");

    const mappings = await workflows.getNetworkMappings(["eip155:5"]);
    expect(mappings).toHaveLength(0);
  });

  test("list all network mappings", async () => {
    await workflows.saveNetworkMapping("eip155:1", { chainId: "1" });
    await workflows.saveNetworkMapping("eip155:11155111", { chainId: "11155111" });
    await workflows.saveNetworkMapping("besu:corp", { chainId: "1337" });

    const all = await workflows.getNetworkMappings();
    expect(all).toHaveLength(3);
  });

  test("empty result for unknown networkId", async () => {
    const mappings = await workflows.getNetworkMappings(["does-not-exist"]);
    expect(mappings).toHaveLength(0);
  });

  test("asset storage includes network_id", async () => {
    await workflows.saveAsset({
      id: "asset-1",
      type: "finp2p",
      contract_address: "0x123",
      decimals: 18,
      token_standard: "ERC20",
      network_id: "eip155:11155111",
    });

    const asset = await workflows.getAsset({ id: "asset-1", type: "finp2p" });
    expect(asset).toBeDefined();
    expect(asset!.network_id).toBe("eip155:11155111");
  });

  test("asset storage with null network_id", async () => {
    await workflows.saveAsset({
      id: "asset-2",
      type: "finp2p",
      contract_address: "0x456",
      decimals: 4,
      token_standard: "ERC20",
    });

    const asset = await workflows.getAsset({ id: "asset-2", type: "finp2p" });
    expect(asset).toBeDefined();
    expect(asset!.network_id).toBeNull();
  });
});

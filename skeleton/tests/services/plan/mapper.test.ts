import { executionFromAPI } from "../../../src/services/plan/mapper";
import { ValidationError } from "../../../src/models";
import { OpComponents } from "@owneraio/finp2p-client";

const finId = "02aa".padEnd(66, "0");
const sourceAssetId = "org1:102:aaaaaaaa-0000-0000-0000-000000000001";
const destAssetId = "org1:102:bbbbbbbb-0000-0000-0000-000000000002";

const ledgerIdentifier = {
  assetIdentifierType: "CAIP-19",
  network: "hedera:mainnet",
  standard: "HEDERA_ATS",
  tokenId: "0x0000000000000000000000000000000000000001",
} as const;

const assetAccount = (assetId: string): OpComponents["schemas"]["finp2pAssetAccount"] => ({
  account: { type: "finId", finId, orgId: "org1", custodian: { orgId: "org1" } },
  asset: { id: assetId, ledgerIdentifier },
});

const moveExecutionPlan = {
  id: "org1:106:cccccccc-0000-0000-0000-000000000003",
  intent: { intent: { type: "moveIntent" } },
  contract: {
    investors: [
      { investor: "org1:101:dddddddd-0000-0000-0000-000000000004", role: "buyer" },
      { investor: "org1:101:dddddddd-0000-0000-0000-000000000004", role: "seller" },
    ],
    contractDetails: {
      type: "move",
      asset: {
        term: { amount: "5" },
        instruction: {
          sourceAccount: assetAccount(sourceAssetId),
          destinationAccount: assetAccount(destAssetId),
        },
      },
    },
  },
  instructions: [],
} as unknown as OpComponents["schemas"]["executionPlan"];

describe("plan mapper", () => {
  test("parses a move contract into the asset leg", () => {
    const plan = executionFromAPI(moveExecutionPlan);

    expect(plan.intentType).toBe("moveIntent");
    expect(plan.contract.asset).toEqual({
      asset: { assetType: "finp2p", assetId: sourceAssetId, ledgerIdentifier },
      amount: "5",
      source: { finId, orgId: "org1", custodianOrgId: "org1" },
      destination: { finId, orgId: "org1", custodianOrgId: "org1" },
    });
    expect(plan.contract.payment).toBeUndefined();
    expect(plan.contract.investors).toEqual([
      { profileId: "org1:101:dddddddd-0000-0000-0000-000000000004", role: "buyer" },
      { profileId: "org1:101:dddddddd-0000-0000-0000-000000000004", role: "seller" },
    ]);
  });
});

const ledgerAccount = (assetId: string): OpComponents["schemas"]["ledgerAccountAsset"] => ({
  finp2pAccount: assetAccount(assetId),
});

const planWithInstruction = (operation: unknown) => ({
  id: "org1:106:cccccccc-0000-0000-0000-000000000003",
  contract: { investors: [], contractDetails: { type: "move", asset: {
    term: { amount: "5" },
    instruction: { sourceAccount: assetAccount(sourceAssetId), destinationAccount: assetAccount(destAssetId) },
  } } },
  instructions: [{ sequence: 1, organizations: ["org1"], executionPlanOperation: operation }],
} as unknown as OpComponents["schemas"]["executionPlan"]);

const finIdAccount = { finId, orgId: "org1", custodianOrgId: "org1" };
const sourceAsset = { assetType: "finp2p", assetId: sourceAssetId, ledgerIdentifier };
const destAsset = { assetType: "finp2p", assetId: destAssetId, ledgerIdentifier };

describe("plan mapper instructions", () => {
  test("maps a swap instruction, keeping each leg's own asset bindings", () => {
    const plan = executionFromAPI(planWithInstruction({
      type: "swap",
      asset: { source: ledgerAccount(sourceAssetId), destination: ledgerAccount(destAssetId), amount: "5" },
      settlement: { source: ledgerAccount(destAssetId), destination: ledgerAccount(sourceAssetId), amount: "100" },
      deadline: 1771200000,
    }));

    expect(plan.instructions[0].operation).toEqual({
      type: "swap",
      asset: {
        asset: sourceAsset, destinationAsset: destAsset,
        source: finIdAccount, destination: finIdAccount, amount: "5",
      },
      settlement: {
        asset: destAsset, destinationAsset: sourceAsset,
        source: finIdAccount, destination: finIdAccount, amount: "100",
      },
      deadline: 1771200000,
    });
  });

  test("maps a move instruction", () => {
    const plan = executionFromAPI(planWithInstruction({
      type: "move",
      investor: "org1:101:dddddddd-0000-0000-0000-000000000004",
      source: ledgerAccount(sourceAssetId),
      destination: ledgerAccount(destAssetId),
      amount: "7",
    }));

    expect(plan.instructions[0].operation).toEqual({
      type: "move",
      investor: "org1:101:dddddddd-0000-0000-0000-000000000004",
      asset: sourceAsset, destinationAsset: destAsset,
      source: finIdAccount, destination: finIdAccount, amount: "7",
    });
  });

  test("rejects an unknown instruction type instead of yielding undefined", () => {
    expect(() => executionFromAPI(planWithInstruction({ type: "teleport" })))
      .toThrow(ValidationError);
  });
});

describe("plan mapper public surface", () => {
  // Canton's approval service parses plans itself; without this export it
  // hand-copies executionFromAPI and drifts from the instruction union.
  test("executionFromAPI is reachable from the package entry point", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("../../../src");
    expect(typeof pkg.executionFromAPI).toBe("function");
    expect(typeof pkg.assetFromFinp2pAsset).toBe("function");
  });
});

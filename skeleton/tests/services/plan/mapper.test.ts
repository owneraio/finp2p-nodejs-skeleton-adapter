import { executionFromAPI } from "../../../src/services/plan/mapper";
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

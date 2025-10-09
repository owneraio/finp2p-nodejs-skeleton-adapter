import { LedgerAPIClient } from "./api/api";
import { TestDataBuilder } from "./utils/test-builders";
import { ReceiptAssertions, TestHelpers } from "./utils/test-assertions";
import { TestFixtures } from "./utils/test-fixtures";
import { ADDRESSES, SCENARIOS, ACTOR_NAMES } from "./utils/test-constants";
import { v4 as uuidv4 } from "uuid";

describe('Token Service Tests (Improved)', () => {

  let client: LedgerAPIClient;
  let builder: TestDataBuilder;
  let fixtures: TestFixtures;
  let orgId: string;

  beforeAll(async () => {
    // @ts-ignore
    client = new LedgerAPIClient(global.serverAddress);
    // @ts-ignore
    orgId = global.orgId;

    builder = new TestDataBuilder(orgId, 1, ADDRESSES.ZERO_ADDRESS);
    fixtures = new TestFixtures(client, builder);
  });

  describe('Token Lifecycle', () => {
    test('should issue, transfer, and verify balances', async () => {
      // Setup: Create actors and asset
      const issuer = builder.buildActor(ACTOR_NAMES.ISSUER);
      const primaryBuyer = builder.buildActor('primaryBuyer');
      const secondaryBuyer = builder.buildActor('secondaryBuyer');
      const asset = builder.buildFinP2PAsset();

      const scenario = SCENARIOS.ISSUE_TRANSFER_REDEEM;

      // Step 1: Setup issued tokens
      const { receipt: issueReceipt } = await fixtures.setupIssuedTokens({
        issuer,
        buyer: primaryBuyer,
        asset,
        amount: scenario.ISSUE_AMOUNT,
        settlementAmount: scenario.ISSUE_SETTLEMENT
      });

      // Verify issue receipt
      ReceiptAssertions.expectIssueReceipt(issueReceipt, {
        asset,
        quantity: scenario.ISSUE_AMOUNT,
        destinationFinId: issuer.finId
      });

      // Step 2: Transfer tokens to secondary buyer
      const transferRequest = await builder.buildSignedTransferRequest({
        seller: issuer,
        buyer: secondaryBuyer,
        asset,
        amount: scenario.TRANSFER_AMOUNT,
        settlementAmount: scenario.TRANSFER_SETTLEMENT
      });

      const transferReceipt = await TestHelpers.transferAndGetReceipt(client, transferRequest);

      // Verify transfer receipt
      ReceiptAssertions.expectTransferReceipt(transferReceipt, {
        asset,
        quantity: scenario.TRANSFER_AMOUNT,
        sourceFinId: issuer.finId,
        destinationFinId: secondaryBuyer.finId
      });

      // Verify final balances
      await client.expectBalance(issuer.source, asset, scenario.EXPECTED_SELLER_BALANCE);
      await client.expectBalance(secondaryBuyer.source, asset, scenario.EXPECTED_BUYER_BALANCE);
    });
  });

  describe('Escrow Operations', () => {
    test('should hold and release funds', async () => {
      // Setup: Create actors and fiat asset with balance
      const buyer = builder.buildActor(ACTOR_NAMES.BUYER);
      const seller = builder.buildActor(ACTOR_NAMES.SELLER);

      const scenario = SCENARIOS.ESCROW_HOLD_RELEASE;

      const { asset } = await fixtures.setupFiatAssetWithBalance({
        owner: buyer,
        fiatCode: "USD",
        initialBalance: scenario.INITIAL_BALANCE
      });

      // Verify seller has zero balance
      await client.expectBalance(seller.source, asset, 0);

      // Step 1: Hold funds in escrow
      const operationId = uuidv4();
      const assetId = builder.buildFinP2PAsset().resourceId;

      const { holdReceipt } = await fixtures.setupEscrowHold({
        source: buyer,
        destination: seller,
        asset,
        assetId,
        amount: scenario.HOLD_AMOUNT,
        settlementAmount: scenario.SETTLEMENT_AMOUNT,
        operationId
      });

      // Verify hold receipt
      ReceiptAssertions.expectHoldReceipt(holdReceipt, {
        asset,
        quantity: scenario.SETTLEMENT_AMOUNT,
        sourceFinId: buyer.finId
      });

      // Verify balance after hold
      await client.expectBalance(buyer.source, asset, scenario.EXPECTED_AFTER_HOLD);

      // Step 2: Release funds to seller
      const releaseRequest = builder.buildReleaseRequest({
        source: buyer,
        destination: seller,
        asset,
        quantity: scenario.SETTLEMENT_AMOUNT,
        operationId
      });

      const releaseReceipt = await TestHelpers.releaseAndGetReceipt(client, releaseRequest);

      // Verify release receipt
      ReceiptAssertions.expectReleaseReceipt(releaseReceipt, {
        asset,
        quantity: scenario.SETTLEMENT_AMOUNT,
        sourceFinId: buyer.finId,
        destinationFinId: seller.finId
      });

      // Verify final balance
      await client.expectBalance(seller.source, asset, scenario.EXPECTED_AFTER_RELEASE);
    });

    test('should hold and redeem tokens', async () => {
      // Setup: Create actors and asset
      const investor = builder.buildActor(ACTOR_NAMES.INVESTOR);
      const issuer = builder.buildActor(ACTOR_NAMES.ISSUER);
      const asset = builder.buildFinP2PAsset();

      const scenario = SCENARIOS.ESCROW_HOLD_REDEEM;

      // Setup redemption scenario with issued tokens
      await fixtures.setupRedemptionScenario({
        investor,
        issuer,
        asset,
        issueAmount: scenario.ISSUE_AMOUNT
      });

      // Step 1: Hold tokens for redemption
      const operationId = uuidv4();
      const { holdRequest, redeemRequest } = await builder.buildRedeemRequests({
        investor,
        issuer,
        asset,
        amount: scenario.REDEEM_AMOUNT,
        settlementAmount: scenario.SETTLEMENT_AMOUNT,
        operationId
      });

      const holdReceipt = await TestHelpers.holdAndGetReceipt(client, holdRequest);

      // Verify hold receipt
      ReceiptAssertions.expectHoldReceipt(holdReceipt, {
        asset,
        quantity: scenario.REDEEM_AMOUNT,
        sourceFinId: investor.finId
      });

      // Verify balance after hold (but before redeem)
      await client.expectBalance(investor.source, asset, scenario.EXPECTED_AFTER_REDEEM);

      // Step 2: Redeem the held tokens
      const redeemReceipt = await TestHelpers.redeemAndGetReceipt(client, redeemRequest);

      // Verify redeem receipt
      ReceiptAssertions.expectRedeemReceipt(redeemReceipt, {
        asset,
        quantity: scenario.REDEEM_AMOUNT,
        sourceFinId: investor.finId
      });

      // Verify final balances (tokens are burned)
      await client.expectBalance(issuer.source, asset, scenario.EXPECTED_AFTER_REDEEM);
    });
  });
});

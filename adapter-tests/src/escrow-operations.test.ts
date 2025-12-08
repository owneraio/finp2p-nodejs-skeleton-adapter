import { LedgerAPIClient } from './api/api';
import { TestDataBuilder } from './utils/test-builders';
import { ReceiptAssertions, TestHelpers } from './utils/test-assertions';
import { TestFixtures } from './utils/test-fixtures';
import { ADDRESSES, SCENARIOS, ACTOR_NAMES } from './utils/test-constants';
import { generateId } from './utils/utils';

describe('Escrow Operations', () => {

  let client: LedgerAPIClient;
  let builder: TestDataBuilder;
  let fixtures: TestFixtures;
  let orgId: string;

  beforeAll(async () => {
    // @ts-ignore
    client = new LedgerAPIClient(global.serverAddress, global.callbackServer);
    // @ts-ignore
    orgId = global.orgId;

    builder = new TestDataBuilder(orgId, 1, ADDRESSES.ZERO_ADDRESS);
    fixtures = new TestFixtures(client, builder);
  });

  test('should hold and release funds', async () => {
    // Setup: Create actors and fiat asset with balance
    const buyer = builder.buildActor(ACTOR_NAMES.BUYER);
    const seller = builder.buildActor(ACTOR_NAMES.SELLER);

    const scenario = SCENARIOS.ESCROW_HOLD_RELEASE;

    const { asset } = await fixtures.setupFiatAssetWithBalance({
      owner: buyer,
      fiatCode: 'USD',
      initialBalance: scenario.INITIAL_BALANCE,
    });

    // Verify seller has zero balance
    await client.expectBalance(seller.source, asset, 0);

    // Step 1: Hold funds in escrow
    const operationId = generateId();
    const assetId = builder.buildFinP2PAsset().resourceId;

    const { holdReceipt } = await fixtures.setupEscrowHold({
      source: buyer,
      destination: seller,
      asset,
      assetId,
      amount: scenario.HOLD_AMOUNT,
      settlementAmount: scenario.SETTLEMENT_AMOUNT,
      operationId,
    });

    // Verify hold receipt
    ReceiptAssertions.expectHoldReceipt(holdReceipt, {
      asset,
      quantity: scenario.SETTLEMENT_AMOUNT,
      sourceFinId: buyer.finId,
    });

    // Verify balance after hold
    await client.expectBalance(buyer.source, asset, scenario.EXPECTED_AFTER_HOLD);

    // Step 2: Release funds to seller
    const releaseRequest = builder.buildReleaseRequest({
      source: buyer,
      destination: seller,
      asset,
      quantity: scenario.SETTLEMENT_AMOUNT,
      operationId,
    });

    const releaseReceipt = await TestHelpers.releaseAndGetReceipt(client, releaseRequest);

    // Verify release receipt
    ReceiptAssertions.expectReleaseReceipt(releaseReceipt, {
      asset,
      quantity: scenario.SETTLEMENT_AMOUNT,
      sourceFinId: buyer.finId,
      destinationFinId: seller.finId,
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
      issueAmount: scenario.ISSUE_AMOUNT,
    });

    // Step 1: Hold tokens for redemption
    const operationId = generateId();
    const { holdRequest, redeemRequest } = await builder.buildRedeemRequests({
      investor,
      issuer,
      asset,
      amount: scenario.REDEEM_AMOUNT,
      settlementAmount: scenario.SETTLEMENT_AMOUNT,
      operationId,
    });

    const holdReceipt = await TestHelpers.holdAndGetReceipt(client, holdRequest);

    // Verify hold receipt
    ReceiptAssertions.expectHoldReceipt(holdReceipt, {
      asset,
      quantity: scenario.REDEEM_AMOUNT,
      sourceFinId: investor.finId,
    });

    // Verify balance after hold (but before redeem)
    await client.expectBalance(investor.source, asset, scenario.EXPECTED_AFTER_REDEEM);

    // Step 2: Redeem the held tokens
    const redeemReceipt = await TestHelpers.redeemAndGetReceipt(client, redeemRequest);

    // Verify redeem receipt
    ReceiptAssertions.expectRedeemReceipt(redeemReceipt, {
      asset,
      quantity: scenario.REDEEM_AMOUNT,
      sourceFinId: investor.finId,
    });

    // Verify final balances (tokens are burned)
    await client.expectBalance(issuer.source, asset, scenario.EXPECTED_AFTER_REDEEM);
  });
});

import { LedgerAPIClient } from './api/api';
import { ReceiptAssertions, TestHelpers } from './utils/test-assertions';
import { TestSetup } from './utils/test-setup';
import { TestConfig } from './config';
import {
  holdRequest,
  releaseRequest,
  redeemRequest,
  source,
  finp2pAsset,
} from './plan/plan-request-builders';
import { generateId } from './utils/utils';

export function escrowOperationsTests(config: TestConfig) {
  describe('Escrow Operations', () => {

    let client: LedgerAPIClient;
    let setup: TestSetup;

    beforeAll(() => {
      client = config.network.anyClient();
      setup = new TestSetup(client, config.orgId);
    });

    test('should hold and release funds', async () => {
      const buyer = setup.newFinId();
      const seller = setup.newFinId();
      const assetId = setup.newAssetId();

      const initialBalance = 1000;
      const holdAmount = 1000;

      await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: initialBalance });

      // Verify seller has zero balance
      await client.expectBalance(source(seller), finp2pAsset(assetId), 0);

      // Step 1: Hold funds in escrow
      const operationId = generateId();
      const holdReceipt = await TestHelpers.holdAndGetReceipt(client,
        holdRequest(assetId, buyer, seller, `${holdAmount}`, operationId),
      );

      // Verify hold receipt
      ReceiptAssertions.expectHoldReceipt(holdReceipt, {
        asset: finp2pAsset(assetId),
        quantity: holdAmount,
        sourceFinId: buyer,
      });

      // Verify balance after hold
      await client.expectBalance(source(buyer), finp2pAsset(assetId), initialBalance - holdAmount);

      // Step 2: Release funds to seller
      const releaseReceipt = await TestHelpers.releaseAndGetReceipt(client,
        releaseRequest(assetId, buyer, seller, `${holdAmount}`, operationId),
      );

      // Verify release receipt
      ReceiptAssertions.expectReleaseReceipt(releaseReceipt, {
        asset: finp2pAsset(assetId),
        quantity: holdAmount,
        sourceFinId: buyer,
        destinationFinId: seller,
      });

      // Verify final balance
      await client.expectBalance(source(seller), finp2pAsset(assetId), holdAmount);
    });

    test('should hold and redeem tokens', async () => {
      const investor = setup.newFinId();
      const issuer = setup.newFinId();
      const assetId = setup.newAssetId();

      const issueAmount = 100;
      const redeemAmount = 100;

      await setup.setupRedemptionScenario({
        assetId, investorFinId: investor, issuerFinId: issuer, amount: issueAmount,
      });

      // Step 1: Hold tokens for redemption
      const operationId = generateId();
      const holdReceipt = await TestHelpers.holdAndGetReceipt(client,
        holdRequest(assetId, investor, issuer, `${redeemAmount}`, operationId),
      );

      // Verify hold receipt
      ReceiptAssertions.expectHoldReceipt(holdReceipt, {
        asset: finp2pAsset(assetId),
        quantity: redeemAmount,
        sourceFinId: investor,
      });

      // Verify balance after hold (but before redeem)
      await client.expectBalance(source(investor), finp2pAsset(assetId), issueAmount - redeemAmount);

      // Step 2: Redeem the held tokens
      const redeemReceipt = await TestHelpers.redeemAndGetReceipt(client,
        redeemRequest(assetId, investor, `${redeemAmount}`, operationId),
      );

      // Verify redeem receipt
      ReceiptAssertions.expectRedeemReceipt(redeemReceipt, {
        asset: finp2pAsset(assetId),
        quantity: redeemAmount,
        sourceFinId: investor,
      });

      // Verify final balances (tokens are burned)
      await client.expectBalance(source(issuer), finp2pAsset(assetId), issueAmount - redeemAmount);
    });
  });
}

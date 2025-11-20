import { LedgerAPIClient } from './api/api';
import { TestDataBuilder } from './utils/test-builders';
import { TestFixtures } from './utils/test-fixtures';
import { ADDRESSES, ACTOR_NAMES } from './utils/test-constants';
import { generateId } from './utils/utils';

export function insufficientBalanceTest() {
  describe('Insufficient Balance - Negative Tests', () => {

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

    describe('Transfer Insufficient Balance', () => {
      test('should fail when transferring more tokens than available balance', async () => {
        // Setup: Create issuer with limited balance
        const issuer = builder.buildActor(ACTOR_NAMES.ISSUER);
        const buyer = builder.buildActor(ACTOR_NAMES.BUYER);
        const asset = builder.buildFinP2PAsset();

        const initialBalance = 100;

        // Issue tokens to issuer
        await fixtures.setupIssuedTokens({
          issuer,
          buyer: builder.buildActor('primaryBuyer'),
          asset,
          amount: initialBalance,
          settlementAmount: 1000,
        });

        // Verify initial balance
        await client.expectBalance(issuer.source, asset, initialBalance);

        // Attempt to transfer MORE than available balance
        const excessiveAmount = initialBalance + 50; // 150 tokens when only 100 available

        const transferRequest = await builder.buildSignedTransferRequest({
          seller: issuer,
          buyer: buyer,
          asset,
          amount: excessiveAmount,
          settlementAmount: excessiveAmount * 10,
        });

        // Execute transfer and expect it to fail
        const transferStatus = await client.tokens.transfer(transferRequest);

        // Verify operation has error
        expect(transferStatus.error).toBeDefined();
        expect(transferStatus.isCompleted).toBe(true);

        // Verify balances remain unchanged
        await client.expectBalance(issuer.source, asset, initialBalance);
        await client.expectBalance(buyer.source, asset, 0);
      });

      test('should fail when transferring exact balance plus one', async () => {
        const seller = builder.buildActor(ACTOR_NAMES.SELLER);
        const buyer = builder.buildActor(ACTOR_NAMES.BUYER);
        const asset = builder.buildFinP2PAsset();

        const exactBalance = 500;

        // Issue exact balance
        await fixtures.setupIssuedTokens({
          issuer: seller,
          buyer: builder.buildActor('primaryBuyer'),
          asset,
          amount: exactBalance,
          settlementAmount: 5000,
        });

        // Try to transfer one more than balance
        const transferRequest = await builder.buildSignedTransferRequest({
          seller: seller,
          buyer: buyer,
          asset,
          amount: exactBalance + 1,
          settlementAmount: (exactBalance + 1) * 10,
        });

        const transferStatus = await client.tokens.transfer(transferRequest);

        // Should fail
        expect(transferStatus.error).toBeDefined();

        // Balances should be unchanged
        await client.expectBalance(seller.source, asset, exactBalance);
        await client.expectBalance(buyer.source, asset, 0);
      });
    });

    describe('Redeem Insufficient Balance', () => {
      test('should fail when redeeming more tokens than available', async () => {
        const investor = builder.buildActor(ACTOR_NAMES.INVESTOR);
        const issuer = builder.buildActor(ACTOR_NAMES.ISSUER);
        const asset = builder.buildFinP2PAsset();

        const initialBalance = 100;

        // Setup redemption scenario with limited balance
        await fixtures.setupRedemptionScenario({
          investor,
          issuer,
          asset,
          issueAmount: initialBalance,
        });

        // Verify balance before redemption attempt
        await client.expectBalance(investor.source, asset, initialBalance);

        // Attempt to redeem MORE than available
        const excessiveRedeemAmount = initialBalance + 50;
        const operationId = generateId();

        const { holdRequest, redeemRequest } = await builder.buildRedeemRequests({
          investor,
          issuer,
          asset,
          amount: excessiveRedeemAmount,
          settlementAmount: excessiveRedeemAmount * 10,
          operationId,
        });

        // Try to hold more than balance
        const holdStatus = await client.escrow.hold(holdRequest);

        // Should fail or error
        expect(holdStatus.error).toBeDefined();

        // Balance should remain unchanged
        await client.expectBalance(investor.source, asset, initialBalance);
      });

      test('should fail when redeeming from zero balance', async () => {
        const investor = builder.buildActor(ACTOR_NAMES.INVESTOR);
        const issuer = builder.buildActor(ACTOR_NAMES.ISSUER);
        const asset = builder.buildFinP2PAsset();

        // Create asset but don't issue any tokens to investor
        await fixtures.setupRedemptionScenario({
          investor,
          issuer,
          asset,
          issueAmount: 0,
        });

        // Verify zero balance
        await client.expectBalance(investor.source, asset, 0);

        // Try to redeem from zero balance
        const operationId = generateId();
        const { holdRequest } = await builder.buildRedeemRequests({
          investor,
          issuer,
          asset,
          amount: 10,
          settlementAmount: 100,
          operationId,
        });

        const holdStatus = await client.escrow.hold(holdRequest);

        // Should fail
        expect(holdStatus.error).toBeDefined();

        // Balance should still be zero
        await client.expectBalance(investor.source, asset, 0);
      });
    });

    describe('Hold Insufficient Balance', () => {
      test('should fail when holding more fiat than available balance', async () => {
        const buyer = builder.buildActor(ACTOR_NAMES.BUYER);
        const seller = builder.buildActor(ACTOR_NAMES.SELLER);

        const initialBalance = 1000;

        // Setup fiat asset with limited balance
        const { asset } = await fixtures.setupFiatAssetWithBalance({
          owner: buyer,
          fiatCode: 'USD',
          initialBalance: initialBalance,
        });

        // Verify initial balance
        await client.expectBalance(buyer.source, asset, initialBalance);

        // Attempt to hold MORE than available
        const excessiveHoldAmount = initialBalance + 500;
        const operationId = generateId();
        const assetId = builder.buildFinP2PAsset().resourceId;

        const holdRequest = await builder.buildSignedHoldRequest({
          source: buyer,
          destination: seller,
          asset,
          assetId,
          amount: 100,
          settlementAmount: excessiveHoldAmount,
          operationId,
        });

        const holdStatus = await client.escrow.hold(holdRequest);

        // Should fail
        expect(holdStatus.error).toBeDefined();

        // Balance should remain unchanged
        await client.expectBalance(buyer.source, asset, initialBalance);
      });

      test('should fail when holding from zero balance', async () => {
        const buyer = builder.buildActor(ACTOR_NAMES.BUYER);
        const seller = builder.buildActor(ACTOR_NAMES.SELLER);

        // Create fiat asset with zero balance
        const { asset } = await fixtures.setupFiatAssetWithBalance({
          owner: buyer,
          fiatCode: 'USD',
          initialBalance: 0,
        });

        // Verify zero balance
        await client.expectBalance(buyer.source, asset, 0);

        // Try to hold any amount from zero balance
        const operationId = generateId();
        const assetId = builder.buildFinP2PAsset().resourceId;

        const holdRequest = await builder.buildSignedHoldRequest({
          source: buyer,
          destination: seller,
          asset,
          assetId,
          amount: 10,
          settlementAmount: 100,
          operationId,
        });

        const holdStatus = await client.escrow.hold(holdRequest);

        // Should fail
        expect(holdStatus.error).toBeDefined();

        // Balance should still be zero
        await client.expectBalance(buyer.source, asset, 0);
      });

      test('should fail when holding after partial consumption of balance', async () => {
        const buyer = builder.buildActor(ACTOR_NAMES.BUYER);
        const seller = builder.buildActor(ACTOR_NAMES.SELLER);

        const initialBalance = 1000;
        const firstHoldAmount = 800;

        // Setup fiat asset with balance
        const { asset } = await fixtures.setupFiatAssetWithBalance({
          owner: buyer,
          fiatCode: 'USD',
          initialBalance: initialBalance,
        });

        // First hold: 800 (should succeed)
        const firstOperationId = generateId();
        const assetId = builder.buildFinP2PAsset().resourceId;

        const firstHoldRequest = await builder.buildSignedHoldRequest({
          source: buyer,
          destination: seller,
          asset,
          assetId,
          amount: 80,
          settlementAmount: firstHoldAmount,
          operationId: firstOperationId,
        });

        const firstHoldStatus = await client.escrow.hold(firstHoldRequest);

        // First hold should succeed
        expect(firstHoldStatus.error).toBeUndefined();

        // Remaining available: 200
        // Now try to hold 300 (should fail)
        const secondOperationId = generateId();
        const secondHoldRequest = await builder.buildSignedHoldRequest({
          source: buyer,
          destination: seller,
          asset,
          assetId: builder.buildFinP2PAsset().resourceId,
          amount: 30,
          settlementAmount: 300,
          operationId: secondOperationId,
        });

        const secondHoldStatus = await client.escrow.hold(secondHoldRequest);

        // Second hold should fail (insufficient available balance)
        expect(secondHoldStatus.error).toBeDefined();
      });
    });

    describe('Multiple Operations - Insufficient Balance', () => {
      test('should fail when combined operations exceed balance', async () => {
        const owner = builder.buildActor('owner');
        const recipient1 = builder.buildActor('recipient1');
        const recipient2 = builder.buildActor('recipient2');
        const asset = builder.buildFinP2PAsset();

        const totalBalance = 100;

        // Setup owner with limited balance
        await fixtures.setupIssuedTokens({
          issuer: owner,
          buyer: builder.buildActor('primaryBuyer'),
          asset,
          amount: totalBalance,
          settlementAmount: 1000,
        });

        // First transfer: 60 tokens (should succeed)
        const firstTransfer = await builder.buildSignedTransferRequest({
          seller: owner,
          buyer: recipient1,
          asset,
          amount: 60,
          settlementAmount: 600,
        });

        const firstStatus = await client.tokens.transfer(firstTransfer);
        expect(firstStatus.error).toBeUndefined();

        // Verify balances after first transfer
        await client.expectBalance(owner.source, asset, 40);
        await client.expectBalance(recipient1.source, asset, 60);

        // Second transfer: 50 tokens (should fail - only 40 remaining)
        const secondTransfer = await builder.buildSignedTransferRequest({
          seller: owner,
          buyer: recipient2,
          asset,
          amount: 50,
          settlementAmount: 500,
        });

        const secondStatus = await client.tokens.transfer(secondTransfer);

        // Should fail
        expect(secondStatus.error).toBeDefined();

        // Balances should remain unchanged after failed transfer
        await client.expectBalance(owner.source, asset, 40);
        await client.expectBalance(recipient2.source, asset, 0);
      });
    });
  });
}

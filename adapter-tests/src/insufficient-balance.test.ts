import { LedgerAPIClient } from './api/api';
import { TestHelpers } from './utils/test-assertions';
import { TestSetup } from './utils/test-setup';
import { TestConfig } from './config';
import {
  issueRequest,
  transferRequest,
  holdRequest,
  redeemRequest,
  source,
  finp2pAsset,
} from './plan/plan-request-builders';
import { generateId } from './utils/utils';

export function insufficientBalanceTests(config: TestConfig) {
  describe('Insufficient Balance - Negative Tests', () => {

    let client: LedgerAPIClient;
    let setup: TestSetup;

    beforeAll(() => {
      client = config.network.anyClient();
      setup = new TestSetup(client, config.orgId);
    });

    describe('Transfer Insufficient Balance', () => {
      test('should fail when transferring more tokens than available balance', async () => {
        const issuer = setup.newFinId();
        const buyer = setup.newFinId();
        const assetId = setup.newAssetId();

        const initialBalance = 100;

        await setup.createAndIssue(assetId, issuer, initialBalance);
        await client.expectBalance(source(issuer), finp2pAsset(assetId), initialBalance);

        // Attempt to transfer MORE than available balance
        const excessiveAmount = initialBalance + 50;

        const transferStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.transfer(transferRequest(assetId, issuer, buyer, `${excessiveAmount}`)),
        );

        expect(transferStatus.error).toBeDefined();
        expect(transferStatus.isCompleted).toBe(true);

        // Verify balances remain unchanged
        await client.expectBalance(source(issuer), finp2pAsset(assetId), initialBalance);
        await client.expectBalance(source(buyer), finp2pAsset(assetId), 0);
      });

      test('should fail when transferring exact balance plus one', async () => {
        const seller = setup.newFinId();
        const buyer = setup.newFinId();
        const assetId = setup.newAssetId();

        const exactBalance = 500;

        await setup.createAndIssue(assetId, seller, exactBalance);

        const transferStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.transfer(transferRequest(assetId, seller, buyer, `${exactBalance + 1}`)),
        );

        expect(transferStatus.error).toBeDefined();

        // Balances should be unchanged
        await client.expectBalance(source(seller), finp2pAsset(assetId), exactBalance);
        await client.expectBalance(source(buyer), finp2pAsset(assetId), 0);
      });
    });

    describe('Redeem Insufficient Balance', () => {
      test('should fail when redeeming more tokens than available', async () => {
        const investor = setup.newFinId();
        const issuer = setup.newFinId();
        const assetId = setup.newAssetId();

        const initialBalance = 100;

        await setup.setupRedemptionScenario({
          assetId, investorFinId: investor, issuerFinId: issuer, amount: initialBalance,
        });

        await client.expectBalance(source(investor), finp2pAsset(assetId), initialBalance);

        // Attempt to hold MORE than available
        const excessiveAmount = initialBalance + 50;
        const operationId = generateId();

        const holdStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.hold(holdRequest(assetId, investor, issuer, `${excessiveAmount}`, operationId)),
        );

        expect(holdStatus.error).toBeDefined();

        // Balance should remain unchanged
        await client.expectBalance(source(investor), finp2pAsset(assetId), initialBalance);
      });

      test('should fail when redeeming from zero balance', async () => {
        const investor = setup.newFinId();
        const issuer = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupRedemptionScenario({
          assetId, investorFinId: investor, issuerFinId: issuer, amount: 0,
        });

        await client.expectBalance(source(investor), finp2pAsset(assetId), 0);

        const operationId = generateId();
        const holdStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.hold(holdRequest(assetId, investor, issuer, '10', operationId)),
        );

        expect(holdStatus.error).toBeDefined();

        // Balance should still be zero
        await client.expectBalance(source(investor), finp2pAsset(assetId), 0);
      });
    });

    describe('Hold Insufficient Balance', () => {
      test('should fail when holding more than available balance', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const assetId = setup.newAssetId();

        const initialBalance = 1000;

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: initialBalance });

        // Attempt to hold MORE than available
        const excessiveHoldAmount = initialBalance + 500;
        const operationId = generateId();

        const holdStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.hold(holdRequest(assetId, buyer, seller, `${excessiveHoldAmount}`, operationId)),
        );

        expect(holdStatus.error).toBeDefined();

        // Balance should remain unchanged
        await client.expectBalance(source(buyer), finp2pAsset(assetId), initialBalance);
      });

      test('should fail when holding from zero balance', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: 0 });

        const operationId = generateId();
        const holdStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.hold(holdRequest(assetId, buyer, seller, '100', operationId)),
        );

        expect(holdStatus.error).toBeDefined();

        // Balance should still be zero
        await client.expectBalance(source(buyer), finp2pAsset(assetId), 0);
      });

      test('should fail when holding after partial consumption of balance', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const assetId = setup.newAssetId();

        const initialBalance = 1000;
        const firstHoldAmount = 800;

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: initialBalance });

        // First hold: 800 (should succeed)
        const firstOperationId = await setup.setupEscrowHold({
          assetId, srcFinId: buyer, dstFinId: seller, amount: firstHoldAmount,
        });

        // Remaining available: 200
        // Now try to hold 300 (should fail)
        const secondOperationId = generateId();
        const secondHoldStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.hold(holdRequest(assetId, buyer, seller, '300', secondOperationId)),
        );

        expect(secondHoldStatus.error).toBeDefined();
      });
    });

    describe('Multiple Operations - Insufficient Balance', () => {
      test('should fail when combined operations exceed balance', async () => {
        const owner = setup.newFinId();
        const recipient1 = setup.newFinId();
        const recipient2 = setup.newFinId();
        const assetId = setup.newAssetId();

        const totalBalance = 100;

        await setup.createAndIssue(assetId, owner, totalBalance);

        // First transfer: 60 tokens (should succeed)
        const firstStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.transfer(transferRequest(assetId, owner, recipient1, '60')),
        );
        expect(firstStatus.error).toBeUndefined();

        // Verify balances after first transfer
        await client.expectBalance(source(owner), finp2pAsset(assetId), 40);
        await client.expectBalance(source(recipient1), finp2pAsset(assetId), 60);

        // Second transfer: 50 tokens (should fail - only 40 remaining)
        const secondStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.transfer(transferRequest(assetId, owner, recipient2, '50')),
        );

        expect(secondStatus.error).toBeDefined();

        // Balances should remain unchanged after failed transfer
        await client.expectBalance(source(owner), finp2pAsset(assetId), 40);
        await client.expectBalance(source(recipient2), finp2pAsset(assetId), 0);
      });
    });
  });
}

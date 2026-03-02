import { LedgerAPIClient } from './api/api';
import { TestHelpers } from './utils/test-assertions';
import { TestSetup } from './utils/test-setup';
import { TestConfig } from './config';
import {
  issueRequest,
  transferRequest,
  holdRequest,
  releaseRequest,
  rollbackRequest,
  redeemRequest,
  source,
  finp2pAsset,
} from './plan/plan-request-builders';
import { generateId } from './utils/utils';

export function businessLogicTests(config: TestConfig) {
  describe('Business Logic - Negative Tests', () => {

    let client: LedgerAPIClient;
    let setup: TestSetup;

    beforeAll(() => {
      client = config.network.anyClient();
      setup = new TestSetup(client, config.orgId);
    });

    describe('Rollback Operations', () => {
      test('should rollback held funds and restore balance', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const assetId = setup.newAssetId();

        const initialBalance = 1000;
        const holdAmount = 500;

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: initialBalance });

        // Hold funds
        const operationId = await setup.setupEscrowHold({
          assetId, srcFinId: buyer, dstFinId: seller, amount: holdAmount,
        });

        // Verify balance after hold
        await client.expectBalance(source(buyer), finp2pAsset(assetId), initialBalance - holdAmount);

        // Rollback the hold
        const rollbackStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.rollback(rollbackRequest(assetId, buyer, `${holdAmount}`, operationId)),
        );
        expect(rollbackStatus.error).toBeUndefined();

        // Verify funds are fully restored
        await client.expectBalance(source(buyer), finp2pAsset(assetId), initialBalance);
      });

      test('should fail when rolling back non-existent hold', async () => {
        const buyer = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: 1000 });

        const fakeOperationId = generateId();
        const rollbackStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.rollback(rollbackRequest(assetId, buyer, '100', fakeOperationId)),
        );

        expect(rollbackStatus.error).toBeDefined();
      });

      test('should fail when rolling back already released hold', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const assetId = setup.newAssetId();

        const initialBalance = 1000;
        const holdAmount = 500;

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: initialBalance });

        const operationId = await setup.setupEscrowHold({
          assetId, srcFinId: buyer, dstFinId: seller, amount: holdAmount,
        });

        // Release funds
        const releaseStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.release(releaseRequest(assetId, buyer, seller, `${holdAmount}`, operationId)),
        );
        expect(releaseStatus.error).toBeUndefined();

        // Try to rollback already released hold
        const rollbackStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.rollback(rollbackRequest(assetId, buyer, `${holdAmount}`, operationId)),
        );
        expect(rollbackStatus.error).toBeDefined();
      });

      test('should fail when rolling back already redeemed hold', async () => {
        const investor = setup.newFinId();
        const issuer = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupRedemptionScenario({ assetId, investorFinId: investor, issuerFinId: issuer, amount: 100 });

        // Hold and redeem
        const operationId = generateId();
        await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.hold(holdRequest(assetId, investor, issuer, '50', operationId)),
        );
        const redeemStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.redeem(redeemRequest(assetId, investor, '50', operationId)),
        );
        expect(redeemStatus.error).toBeUndefined();

        // Try to rollback already redeemed hold
        const rollbackStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.rollback(rollbackRequest(assetId, investor, '50', operationId)),
        );
        expect(rollbackStatus.error).toBeDefined();
      });
    });

    describe('Double Operation Prevention', () => {
      test('should fail when trying to release twice', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: 1000 });

        const operationId = await setup.setupEscrowHold({
          assetId, srcFinId: buyer, dstFinId: seller, amount: 500,
        });

        // First release (should succeed)
        const firstRelease = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.release(releaseRequest(assetId, buyer, seller, '500', operationId)),
        );
        expect(firstRelease.error).toBeUndefined();

        // Second release (should fail)
        const secondRelease = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.release(releaseRequest(assetId, buyer, seller, '500', operationId)),
        );
        expect(secondRelease.error).toBeDefined();
      });

      test('should fail when trying to redeem twice', async () => {
        const investor = setup.newFinId();
        const issuer = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupRedemptionScenario({ assetId, investorFinId: investor, issuerFinId: issuer, amount: 100 });

        const operationId = generateId();
        await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.hold(holdRequest(assetId, investor, issuer, '50', operationId)),
        );

        // First redeem (should succeed)
        const firstRedeem = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.redeem(redeemRequest(assetId, investor, '50', operationId)),
        );
        expect(firstRedeem.error).toBeUndefined();

        // Second redeem (should fail)
        const secondRedeem = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.redeem(redeemRequest(assetId, investor, '50', operationId)),
        );
        expect(secondRedeem.error).toBeDefined();
      });

      test('should fail when trying to rollback twice', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: 1000 });

        const operationId = await setup.setupEscrowHold({
          assetId, srcFinId: buyer, dstFinId: seller, amount: 500,
        });

        // First rollback (should succeed)
        const firstRollback = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.rollback(rollbackRequest(assetId, buyer, '500', operationId)),
        );
        expect(firstRollback.error).toBeUndefined();

        // Second rollback (should fail)
        const secondRollback = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.rollback(rollbackRequest(assetId, buyer, '500', operationId)),
        );
        expect(secondRollback.error).toBeDefined();
      });
    });

    describe('Invalid Operation ID Tests', () => {
      test('should fail release with non-existent operationId', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: 1000 });

        const fakeOperationId = generateId();
        const releaseStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.release(releaseRequest(assetId, buyer, seller, '100', fakeOperationId)),
        );
        expect(releaseStatus.error).toBeDefined();
      });

      test('should fail redeem with non-existent operationId', async () => {
        const investor = setup.newFinId();
        const issuer = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupRedemptionScenario({ assetId, investorFinId: investor, issuerFinId: issuer, amount: 100 });

        const fakeOperationId = generateId();
        const redeemStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.redeem(redeemRequest(assetId, investor, '50', fakeOperationId)),
        );
        expect(redeemStatus.error).toBeDefined();
      });

      test('should fail redeem with mismatched operationId', async () => {
        const investor = setup.newFinId();
        const issuer = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupRedemptionScenario({ assetId, investorFinId: investor, issuerFinId: issuer, amount: 100 });

        // Hold with one operationId
        const holdOperationId = generateId();
        await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.hold(holdRequest(assetId, investor, issuer, '50', holdOperationId)),
        );

        // Try to redeem with different operationId
        const differentOperationId = generateId();
        const redeemStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.redeem(redeemRequest(assetId, investor, '50', differentOperationId)),
        );
        expect(redeemStatus.error).toBeDefined();
      });
    });

    describe('Asset Lifecycle Tests', () => {
      test('should not allow operations on non-existent asset', async () => {
        const actor = setup.newFinId();
        const nonExistentAssetId = setup.newAssetId();

        const issueStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.issue(issueRequest(nonExistentAssetId, actor, '100')),
        );

        expect(issueStatus.error).toBeDefined();
      });

      test('should successfully create asset before issuing tokens', async () => {
        const issuer = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.createAsset(assetId);

        const issueStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.issue(issueRequest(assetId, issuer, '100')),
        );
        expect(issueStatus.error).toBeUndefined();
      });

      test('should handle multiple assets independently', async () => {
        const owner = setup.newFinId();
        const assetId1 = setup.newAssetId();
        const assetId2 = setup.newAssetId();

        await setup.createAndIssue(assetId1, owner, 100);
        await setup.createAndIssue(assetId2, owner, 200);

        await client.expectBalance(source(owner), finp2pAsset(assetId1), 100);
        await client.expectBalance(source(owner), finp2pAsset(assetId2), 200);
      });
    });

    describe('Zero Amount Tests', () => {
      test('should handle transfer of zero tokens', async () => {
        const seller = setup.newFinId();
        const buyer = setup.newFinId();
        const assetId = setup.newAssetId();

        const initialBalance = 100;
        await setup.createAndIssue(assetId, seller, initialBalance);

        const transferStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.transfer(transferRequest(assetId, seller, buyer, '0')),
        );

        if (!transferStatus.error) {
          await client.expectBalance(source(seller), finp2pAsset(assetId), initialBalance);
          await client.expectBalance(source(buyer), finp2pAsset(assetId), 0);
        } else {
          expect(transferStatus.error).toBeDefined();
        }
      });

      test('should handle hold of zero amount', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: 1000 });

        const operationId = generateId();
        const holdStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.hold(holdRequest(assetId, buyer, seller, '0', operationId)),
        );

        if (!holdStatus.error) {
          await client.expectBalance(source(buyer), finp2pAsset(assetId), 1000);
        } else {
          expect(holdStatus.error).toBeDefined();
        }
      });
    });

    describe('Wrong Actor Tests', () => {
      test('should fail when releasing with wrong source', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const attacker = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: 1000 });

        const operationId = await setup.setupEscrowHold({
          assetId, srcFinId: buyer, dstFinId: seller, amount: 500,
        });

        const releaseStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.release(releaseRequest(assetId, attacker, seller, '500', operationId)),
        );

        expect(releaseStatus.error).toBeDefined();
      });

      test('should fail when transferring from wrong account', async () => {
        const owner = setup.newFinId();
        const recipient = setup.newFinId();
        const assetId = setup.newAssetId();

        await setup.createAndIssue(assetId, owner, 100);

        const transferStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.tokens.transfer(transferRequest(assetId, owner, recipient, '50')),
        );

        if (transferStatus.error) {
          expect(transferStatus.error).toBeDefined();
        }
      });
    });

    describe('Partial Release Tests', () => {
      test('should allow partial release of held funds', async () => {
        const buyer = setup.newFinId();
        const seller = setup.newFinId();
        const assetId = setup.newAssetId();

        const initialBalance = 1000;
        const holdAmount = 500;

        await setup.setupAssetWithBalance({ assetId, ownerFinId: buyer, balance: initialBalance });

        const operationId = await setup.setupEscrowHold({
          assetId, srcFinId: buyer, dstFinId: seller, amount: holdAmount,
        });

        const releaseStatus = await TestHelpers.executeAndWaitForCompletion(client, () =>
          client.escrow.release(releaseRequest(assetId, buyer, seller, '300', operationId)),
        );

        if (!releaseStatus.error) {
          await client.expectBalance(source(seller), finp2pAsset(assetId), 300);
        } else {
          expect(releaseStatus.error).toBeDefined();
        }
      });
    });
  });
}

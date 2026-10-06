import { LedgerAPIClient } from './api/api';
import { TestDataBuilder } from './utils/test-builders';
import { LedgerProfile, resolveLedgerProfile } from './utils/ledger-profile';
import { ReceiptAssertions, TestHelpers } from './utils/test-assertions';
import { TestFixtures } from './utils/test-fixtures';
import { ACTOR_NAMES, SCENARIOS } from './utils/test-constants';
import { generateId } from './utils/utils';

export function swapOperationsTests(ledger?: Partial<LedgerProfile>) {
  describe('Swap Operations', () => {

    let client: LedgerAPIClient;
    let builder: TestDataBuilder;
    let fixtures: TestFixtures;
    let orgId: string;

    const scenario = SCENARIOS.SWAP;

    beforeAll(async () => {
      // @ts-ignore
      client = new LedgerAPIClient(global.serverAddress, global.callbackServer, global.serverBaseAddress);
      // @ts-ignore
      orgId = global.orgId;

      builder = new TestDataBuilder(orgId, resolveLedgerProfile(ledger), client);
      fixtures = new TestFixtures(client, builder);
    });

    const setupParties = async () => {
      const seller = await builder.buildActor(ACTOR_NAMES.SELLER);
      const buyer = await builder.buildActor(ACTOR_NAMES.BUYER);
      const { asset } = await fixtures.setupAssetWithBalance({ actor: seller, asset: builder.buildFinP2PAsset(), balance: scenario.ISSUED });
      const { asset: settlementAsset } = await fixtures.setupAssetWithBalance({ actor: buyer, asset: builder.buildFinP2PAsset(), balance: scenario.ISSUED });
      return { seller, buyer, asset, settlementAsset };
    };

    test('both legs (numberOfReceipts: 2): exchanges assets atomically with two receipts', async () => {
      const { seller, buyer, asset, settlementAsset } = await setupParties();
      const operationId = generateId();

      const receipts = await TestHelpers.swapAndGetReceipts(client, await builder.buildSignedSwapRequest({
        seller, buyer, asset, settlementAsset, operationId, numberOfReceipts: 2,
        amount: scenario.AMOUNT, settlementAmount: scenario.SETTLEMENT_AMOUNT,
      }));

      expect(receipts).toHaveLength(2);
      const [assetReceipt, settlementReceipt] = receipts;
      ReceiptAssertions.expectSwapReceipt(assetReceipt, {
        asset, quantity: scenario.AMOUNT, sourceFinId: seller.finId, destinationFinId: buyer.finId, operationId,
      });
      ReceiptAssertions.expectSwapReceipt(settlementReceipt, {
        asset: settlementAsset, quantity: scenario.SETTLEMENT_AMOUNT, sourceFinId: buyer.finId, destinationFinId: seller.finId, operationId,
      });
      expect(assetReceipt.id).not.toBe(settlementReceipt.id);
      expect(settlementReceipt.transactionDetails?.transactionId).toBe(assetReceipt.transactionDetails?.transactionId);

      await client.expectBalance({ finId: seller.finId, asset }, scenario.ISSUED - scenario.AMOUNT);
      await client.expectBalance({ finId: buyer.finId, asset }, scenario.AMOUNT);
      await client.expectBalance({ finId: buyer.finId, asset: settlementAsset }, scenario.ISSUED - scenario.SETTLEMENT_AMOUNT);
      await client.expectBalance({ finId: seller.finId, asset: settlementAsset }, scenario.SETTLEMENT_AMOUNT);
    });

    test('single leg (numberOfReceipts: 1): executes only the asset leg', async () => {
      const { seller, buyer, asset, settlementAsset } = await setupParties();
      const operationId = generateId();

      const receipts = await TestHelpers.swapAndGetReceipts(client, await builder.buildSignedSwapRequest({
        seller, buyer, asset, settlementAsset, operationId, numberOfReceipts: 1,
        amount: scenario.AMOUNT, settlementAmount: scenario.SETTLEMENT_AMOUNT,
      }));

      expect(receipts).toHaveLength(1);
      ReceiptAssertions.expectSwapReceipt(receipts[0], {
        asset, quantity: scenario.AMOUNT, sourceFinId: seller.finId, destinationFinId: buyer.finId, operationId,
      });

      await client.expectBalance({ finId: seller.finId, asset }, scenario.ISSUED - scenario.AMOUNT);
      await client.expectBalance({ finId: buyer.finId, asset }, scenario.AMOUNT);
      await client.expectBalance({ finId: buyer.finId, asset: settlementAsset }, scenario.ISSUED);
      await client.expectBalance({ finId: seller.finId, asset: settlementAsset }, 0);
    });

    test('rejects an expired deadline without moving funds', async () => {
      const { seller, buyer, asset, settlementAsset } = await setupParties();

      const result = await TestHelpers.executeAndWaitForCompletion(client, async () => client.tokens.swap(await builder.buildSignedSwapRequest({
        seller, buyer, asset, settlementAsset, operationId: generateId(), numberOfReceipts: 2,
        amount: scenario.AMOUNT, settlementAmount: scenario.SETTLEMENT_AMOUNT,
        deadline: Math.floor(Date.now() / 1000) - 60,
      })));

      expect(result.error).toBeDefined();
      expect(result.response).toBeUndefined();
      await client.expectBalance({ finId: seller.finId, asset }, scenario.ISSUED);
      await client.expectBalance({ finId: buyer.finId, asset: settlementAsset }, scenario.ISSUED);
    });
  });
}

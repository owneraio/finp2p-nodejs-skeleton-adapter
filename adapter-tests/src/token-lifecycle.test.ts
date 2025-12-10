import { LedgerAPIClient } from './api/api';
import { TestDataBuilder } from './utils/test-builders';
import { ReceiptAssertions, TestHelpers } from './utils/test-assertions';
import { TestFixtures } from './utils/test-fixtures';
import { ADDRESSES, SCENARIOS, ACTOR_NAMES } from './utils/test-constants';

export function tokenLifecycleTests() {
  describe('Token Lifecycle', () => {

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
        settlementAmount: scenario.ISSUE_SETTLEMENT,
      });

      // Verify issue receipt
      ReceiptAssertions.expectIssueReceipt(issueReceipt, {
        asset,
        quantity: scenario.ISSUE_AMOUNT,
        destinationFinId: issuer.finId,
      });

      // Step 2: Transfer tokens to secondary buyer
      const transferRequest = await builder.buildSignedTransferRequest({
        seller: issuer,
        buyer: secondaryBuyer,
        asset,
        amount: scenario.TRANSFER_AMOUNT,
        settlementAmount: scenario.TRANSFER_SETTLEMENT,
      });

      const transferReceipt = await TestHelpers.transferAndGetReceipt(client, transferRequest);

      // Verify transfer receipt
      ReceiptAssertions.expectTransferReceipt(transferReceipt, {
        asset,
        quantity: scenario.TRANSFER_AMOUNT,
        sourceFinId: issuer.finId,
        destinationFinId: secondaryBuyer.finId,
      });

      // Verify final balances
      await client.expectBalance(issuer.source, asset, scenario.EXPECTED_SELLER_BALANCE);
      await client.expectBalance(secondaryBuyer.source, asset, scenario.EXPECTED_BUYER_BALANCE);
    });
  });
}

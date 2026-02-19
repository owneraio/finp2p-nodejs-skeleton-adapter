import { LedgerAPIClient } from './api/api';
import { TestHelpers } from './utils/test-assertions';
import { TestSetup } from './utils/test-setup';
import { TestConfig } from './config';
import {
  issueRequest,
  transferRequest,
  source,
  finp2pAsset,
} from './plan/plan-request-builders';

export function tokenLifecycleTests(config: TestConfig) {
  describe('Token Lifecycle', () => {

    let client: LedgerAPIClient;
    let setup: TestSetup;

    beforeAll(() => {
      client = config.network.anyClient();
      setup = new TestSetup(client, config.orgId);
    });

    test('should issue, transfer, and verify balances', async () => {
      const issuer = setup.newFinId();
      const buyer = setup.newFinId();
      const assetId = setup.newAssetId();

      // Create asset
      await setup.createAsset(assetId);

      // Issue 1000 tokens to issuer
      const issueRes = await TestHelpers.executeAndWaitForCompletion(client, () =>
        client.tokens.issue(issueRequest(assetId, issuer, '1000')),
      );
      expect(issueRes.isCompleted).toBe(true);
      expect(issueRes.error).toBeUndefined();

      // Verify issuer balance
      await client.expectBalance(source(issuer), finp2pAsset(assetId), 1000);

      // Transfer 600 tokens from issuer to buyer
      const transferRes = await TestHelpers.executeAndWaitForCompletion(client, () =>
        client.tokens.transfer(transferRequest(assetId, issuer, buyer, '600')),
      );
      expect(transferRes.isCompleted).toBe(true);
      expect(transferRes.error).toBeUndefined();

      // Verify final balances
      await client.expectBalance(source(issuer), finp2pAsset(assetId), 400);
      await client.expectBalance(source(buyer), finp2pAsset(assetId), 600);
    });
  });
}

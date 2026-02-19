import { plan, LedgerAPIClient } from '@owneraio/adapter-tests';

const ORG_ID = 'bank-id';

const mockServer = new plan.MockFinP2PServer();
let mockUrl: string;

const network = new plan.FinP2PNetwork();
let client: LedgerAPIClient;

const ASSET_ID = `bank-id:102:${Date.now()}`;
const PAYMENT_ASSET_ID = `bank-id:102:payment-${Date.now()}`;

// Actors (finIds are just identifiers for the in-memory adapter)
const issuer = 'issuer-finid-001';
const buyer = 'buyer-finid-002';
const seller = 'seller-finid-003';

beforeAll(async () => {
  mockUrl = await mockServer.start(0);

  // @ts-ignore — set by test-environment.ts
  const serverAddress: string = global.serverAddress;
  client = new LedgerAPIClient(serverAddress);
  network.addNode(ORG_ID, client);
});

afterAll(async () => {
  await mockServer.stop();
});

describe('Plan-based flow tests', () => {

  test('Create assets', async () => {
    const res1 = await plan.TestHelpers.executeAndWaitForCompletion(client, () =>
      client.tokens.createAsset(plan.createAssetRequest(ASSET_ID)),
    );
    expect(res1.isCompleted).toBe(true);

    const res2 = await plan.TestHelpers.executeAndWaitForCompletion(client, () =>
      client.tokens.createAsset(plan.createAssetRequest(PAYMENT_ASSET_ID)),
    );
    expect(res2.isCompleted).toBe(true);
  });

  test('Seed initial balances', async () => {
    // Issue 1000 tokens to seller
    const issueRes1 = await plan.TestHelpers.executeAndWaitForCompletion(client, () =>
      client.tokens.issue(plan.issueRequest(ASSET_ID, seller, '1000')),
    );
    expect(issueRes1.isCompleted).toBe(true);

    // Issue 10000 payment tokens to buyer
    const issueRes2 = await plan.TestHelpers.executeAndWaitForCompletion(client, () =>
      client.tokens.issue(plan.issueRequest(PAYMENT_ASSET_ID, buyer, '10000')),
    );
    expect(issueRes2.isCompleted).toBe(true);
  });

  // DvP Buying flow: buyer pays, seller transfers asset
  // Instructions:
  //   1. hold(payment) — buyer holds payment for seller
  //   2. transfer(asset) — seller transfers asset to buyer
  //   3. release(payment) — release payment to seller
  //   Fallback: rollback(payment) for instruction 1
  plan.planSuite('DvP Buying', network, () => mockUrl, plan.PlanBuilder.plan()
    .terms({
      asset: { assetId: ASSET_ID, amount: '50', source: seller, destination: buyer },
      settlement: { assetId: PAYMENT_ASSET_ID, amount: '250', source: buyer, destination: seller },
    })
    .instruction(1, [ORG_ID], plan.holdOp(PAYMENT_ASSET_ID, buyer, seller, '250'),
      async () => {
        const bal = await client.common.getBalance({
          asset: { type: 'finp2p', resourceId: PAYMENT_ASSET_ID },
          owner: { finId: buyer, account: { type: 'finId', finId: buyer } },
        });
        expect(parseInt(bal.balance)).toBe(9750);
      })
    .instruction(2, [ORG_ID], plan.transferOp(ASSET_ID, seller, buyer, '50'),
      async () => {
        const sellerBal = await client.common.getBalance({
          asset: { type: 'finp2p', resourceId: ASSET_ID },
          owner: { finId: seller, account: { type: 'finId', finId: seller } },
        });
        expect(parseInt(sellerBal.balance)).toBe(950);

        const buyerBal = await client.common.getBalance({
          asset: { type: 'finp2p', resourceId: ASSET_ID },
          owner: { finId: buyer, account: { type: 'finId', finId: buyer } },
        });
        expect(parseInt(buyerBal.balance)).toBe(50);
      })
    .instruction(3, [ORG_ID], plan.releaseOp(PAYMENT_ASSET_ID, buyer, seller, '250'),
      async () => {
        const buyerBal = await client.common.getBalance({
          asset: { type: 'finp2p', resourceId: PAYMENT_ASSET_ID },
          owner: { finId: buyer, account: { type: 'finId', finId: buyer } },
        });
        expect(parseInt(buyerBal.balance)).toBe(9750);

        const sellerBal = await client.common.getBalance({
          asset: { type: 'finp2p', resourceId: PAYMENT_ASSET_ID },
          owner: { finId: seller, account: { type: 'finId', finId: seller } },
        });
        expect(parseInt(sellerBal.balance)).toBe(250);
      })
    .fallback(4, [ORG_ID], plan.rollbackOp(PAYMENT_ASSET_ID, buyer, '250'), 1)
    .build(),
  );

  // Primary Sale flow: buyer pays, issuer issues new tokens
  plan.planSuite('Primary Sale', network, () => mockUrl, plan.PlanBuilder.plan()
    .terms({
      asset: { assetId: ASSET_ID, amount: '100', destination: buyer },
      settlement: { assetId: PAYMENT_ASSET_ID, amount: '500', source: buyer, destination: issuer },
    })
    .instruction(1, [ORG_ID], plan.holdOp(PAYMENT_ASSET_ID, buyer, issuer, '500'),
      async () => {
        const bal = await client.common.getBalance({
          asset: { type: 'finp2p', resourceId: PAYMENT_ASSET_ID },
          owner: { finId: buyer, account: { type: 'finId', finId: buyer } },
        });
        expect(parseInt(bal.balance)).toBe(9250);
      })
    .instruction(2, [ORG_ID], plan.issueOp(ASSET_ID, buyer, '100'),
      async () => {
        const bal = await client.common.getBalance({
          asset: { type: 'finp2p', resourceId: ASSET_ID },
          owner: { finId: buyer, account: { type: 'finId', finId: buyer } },
        });
        expect(parseInt(bal.balance)).toBe(150);
      })
    .instruction(3, [ORG_ID], plan.releaseOp(PAYMENT_ASSET_ID, buyer, issuer, '500'),
      async () => {
        const issuerBal = await client.common.getBalance({
          asset: { type: 'finp2p', resourceId: PAYMENT_ASSET_ID },
          owner: { finId: issuer, account: { type: 'finId', finId: issuer } },
        });
        expect(parseInt(issuerBal.balance)).toBe(500);
      })
    .fallback(4, [ORG_ID], plan.rollbackOp(PAYMENT_ASSET_ID, buyer, '500'), 1)
    .build(),
  );
});

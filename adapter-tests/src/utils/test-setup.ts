import * as crypto from 'crypto';
import { LedgerAPIClient } from '../api/api';
import { TestHelpers } from './test-assertions';
import {
  createAssetRequest,
  issueRequest,
  holdRequest,
  source,
  finp2pAsset,
} from '../plan/plan-request-builders';
import { generateId, randomResourceId, ASSET } from './utils';

/**
 * High-level test setup helpers.
 *
 * Replaces TestDataBuilder + TestFixtures with plan-based request builders
 * (dummy signatures instead of EIP-712).
 */
export class TestSetup {
  constructor(
    private client: LedgerAPIClient,
    private orgId: string,
  ) {}

  // ---------------------------------------------------------------------------
  // Identity / data generation
  // ---------------------------------------------------------------------------

  /** Generate a random finId (hex string). */
  newFinId(): string {
    return crypto.randomBytes(33).toString('hex');
  }

  /** Generate a random asset resource ID scoped to this org. */
  newAssetId(): string {
    return randomResourceId(this.orgId, ASSET);
  }

  // ---------------------------------------------------------------------------
  // High-level setup helpers
  // ---------------------------------------------------------------------------

  /** Create an asset and wait for completion. */
  async createAsset(assetId: string): Promise<void> {
    await TestHelpers.createAssetAndWait(this.client, createAssetRequest(assetId));
  }

  /** Create an asset and issue tokens to the given finId. */
  async createAndIssue(assetId: string, toFinId: string, quantity: number): Promise<void> {
    await this.createAsset(assetId);
    const res = await TestHelpers.executeAndWaitForCompletion(this.client, () =>
      this.client.tokens.issue(issueRequest(assetId, toFinId, `${quantity}`)),
    );
    if (res.error) throw new Error(`Issue failed: ${res.error.message}`);
  }

  /** Create an asset, issue tokens, and verify the balance. */
  async setupAssetWithBalance(params: {
    assetId: string;
    ownerFinId: string;
    balance: number;
  }): Promise<void> {
    await this.createAsset(params.assetId);
    if (params.balance > 0) {
      await TestHelpers.executeAndWaitForCompletion(this.client, () =>
        this.client.tokens.issue(issueRequest(params.assetId, params.ownerFinId, `${params.balance}`)),
      );
    }
    await this.client.expectBalance(source(params.ownerFinId), finp2pAsset(params.assetId), params.balance);
  }

  /** Hold tokens in escrow. Returns the operationId. */
  async setupEscrowHold(params: {
    assetId: string;
    srcFinId: string;
    dstFinId: string;
    amount: number;
    operationId?: string;
  }): Promise<string> {
    const opId = params.operationId ?? generateId();
    const res = await TestHelpers.executeAndWaitForCompletion(this.client, () =>
      this.client.escrow.hold(holdRequest(params.assetId, params.srcFinId, params.dstFinId, `${params.amount}`, opId)),
    );
    if (res.error) throw new Error(`Hold failed: ${res.error.message}`);
    return opId;
  }

  /** Create an asset, issue tokens to investor, verify investor and issuer balances. */
  async setupRedemptionScenario(params: {
    assetId: string;
    investorFinId: string;
    issuerFinId: string;
    amount: number;
  }): Promise<void> {
    await this.createAsset(params.assetId);
    if (params.amount > 0) {
      await TestHelpers.executeAndWaitForCompletion(this.client, () =>
        this.client.tokens.issue(issueRequest(params.assetId, params.investorFinId, `${params.amount}`)),
      );
    }
    await this.client.expectBalance(source(params.investorFinId), finp2pAsset(params.assetId), params.amount);
    await this.client.expectBalance(source(params.issuerFinId), finp2pAsset(params.assetId), 0);
  }
}

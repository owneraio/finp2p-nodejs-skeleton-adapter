import { v4 as uuidv4 } from "uuid";
import { LedgerAPIClient } from "../api/api";
import { TestActor, TestDataBuilder } from "./test-builders";
import { LedgerAPI } from "../../src";
import { TestHelpers } from "./test-assertions";

/**
 * High-level test fixtures for common test scenarios
 * Encapsulates complex setup patterns to reduce duplication
 */
export class TestFixtures {

  constructor(
    private client: LedgerAPIClient,
    private builder: TestDataBuilder
  ) {}

  /**
   * Sets up an asset with an initial balance for an actor
   * @returns The actor, asset, and balance that were set up
   */
  async setupAssetWithBalance(params: {
    actor: TestActor;
    asset: LedgerAPI["schemas"]["asset"];
    balance: number;
  }): Promise<{
    actor: TestActor;
    asset: LedgerAPI["schemas"]["asset"];
    balance: number;
  }> {
    // Create the asset
    await TestHelpers.createAssetAndWait(
      this.client,
      this.builder.buildCreateAssetRequest({ asset: params.asset })
    );

    // Issue tokens if balance > 0
    if (params.balance > 0) {
      const issueRequest = this.builder.buildIssueRequest({
        destination: params.actor.source.account,
        asset: params.asset,
        quantity: params.balance,
        settlementRef: uuidv4()
      });

      await TestHelpers.issueAndGetReceipt(this.client, issueRequest);
    }

    // Verify the balance
    await this.client.expectBalance(params.actor.source, params.asset, params.balance);

    return {
      actor: params.actor,
      asset: params.asset,
      balance: params.balance
    };
  }

  /**
   * Sets up a complete issue scenario with buyer and issuer
   */
  async setupIssuedTokens(params: {
    issuer: TestActor;
    buyer: TestActor;
    asset: LedgerAPI["schemas"]["finp2pAsset"];
    amount: number;
    settlementAmount: number;
  }): Promise<{
    issuer: TestActor;
    buyer: TestActor;
    asset: LedgerAPI["schemas"]["finp2pAsset"];
    receipt: LedgerAPI["schemas"]["receipt"];
  }> {
    // Create asset
    await TestHelpers.createAssetAndWait(
      this.client,
      this.builder.buildCreateAssetRequest({ asset: params.asset })
    );

    // Issue tokens
    const issueRequest = await this.builder.buildSignedIssueRequest({
      buyer: params.buyer,
      issuer: params.issuer,
      asset: params.asset,
      amount: params.amount,
      settlementAmount: params.settlementAmount
    });

    const receipt = await TestHelpers.issueAndGetReceipt(this.client, issueRequest);

    // Verify balance
    await this.client.expectBalance(params.issuer.source, params.asset, params.amount);

    return {
      issuer: params.issuer,
      buyer: params.buyer,
      asset: params.asset,
      receipt
    };
  }

  /**
   * Sets up a fiat asset with deposit instruction and initial balance
   */
  async setupFiatAssetWithBalance(params: {
    owner: TestActor;
    fiatCode: string;
    initialBalance: number;
  }): Promise<{
    owner: TestActor;
    asset: LedgerAPI["schemas"]["fiatAsset"];
    balance: number;
  }> {
    const asset = this.builder.buildFiatAsset(params.fiatCode);

    // Create asset
    await TestHelpers.createAssetAndWait(
      this.client,
      this.builder.buildCreateAssetRequest({ asset })
    );

    // Get deposit instruction
    const depositRequest = this.builder.buildDepositInstructionRequest({
      owner: params.owner,
      destination: params.owner,
      asset: asset as LedgerAPI["schemas"]["depositAsset"]
    });

    const depositStatus = await this.client.payments.getDepositInstruction(depositRequest);
    await TestHelpers.waitForCompletion(this.client, depositStatus);

    // Set initial balance if needed
    if (params.initialBalance > 0) {
      const issueRequest = this.builder.buildIssueRequest({
        destination: params.owner.source.account,
        asset: {
          resourceId: asset.code,
          type: "finp2p"
        },
        quantity: params.initialBalance,
        settlementRef: uuidv4()
      });

      const setBalanceStatus = await this.client.tokens.issue(issueRequest);
      await TestHelpers.waitForCompletion(this.client, setBalanceStatus);
    }

    // Verify balance
    await this.client.expectBalance(params.owner.source, asset, params.initialBalance);

    return {
      owner: params.owner,
      asset,
      balance: params.initialBalance
    };
  }

  /**
   * Sets up a complete escrow scenario with hold operation
   */
  async setupEscrowHold(params: {
    source: TestActor;
    destination: TestActor;
    asset: LedgerAPI["schemas"]["asset"];
    assetId: string;
    amount: number;
    settlementAmount: number;
    operationId?: string;
  }): Promise<{
    source: TestActor;
    destination: TestActor;
    asset: LedgerAPI["schemas"]["asset"];
    operationId: string;
    holdReceipt: LedgerAPI["schemas"]["receipt"];
  }> {
    const operationId = params.operationId || uuidv4();

    const holdRequest = await this.builder.buildSignedHoldRequest({
      source: params.source,
      destination: params.destination,
      asset: params.asset,
      assetId: params.assetId,
      amount: params.amount,
      settlementAmount: params.settlementAmount,
      operationId
    });

    const holdReceipt = await TestHelpers.holdAndGetReceipt(this.client, holdRequest);

    return {
      source: params.source,
      destination: params.destination,
      asset: params.asset,
      operationId,
      holdReceipt
    };
  }

  /**
   * Sets up a complete redemption scenario with investor and issuer
   */
  async setupRedemptionScenario(params: {
    investor: TestActor;
    issuer: TestActor;
    asset: LedgerAPI["schemas"]["finp2pAsset"];
    issueAmount: number;
  }): Promise<{
    investor: TestActor;
    issuer: TestActor;
    asset: LedgerAPI["schemas"]["finp2pAsset"];
    issueAmount: number;
  }> {
    // Create asset
    await TestHelpers.createAssetAndWait(
      this.client,
      this.builder.buildCreateAssetRequest({ asset: params.asset })
    );

    // Issue tokens to investor
    const issueRequest = this.builder.buildIssueRequest({
      destination: params.investor.source.account,
      asset: params.asset,
      quantity: params.issueAmount
    });

    await TestHelpers.issueAndGetReceipt(this.client, issueRequest);

    // Verify balances
    await this.client.expectBalance(params.investor.source, params.asset, params.issueAmount);
    await this.client.expectBalance(params.issuer.source, params.asset, 0);

    return {
      investor: params.investor,
      issuer: params.issuer,
      asset: params.asset,
      issueAmount: params.issueAmount
    };
  }
}

import { LedgerAPI } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { TestActor } from "./test-builders";

/**
 * Helper class for common receipt assertions
 * Reduces boilerplate and makes test failures more descriptive
 */
export class ReceiptAssertions {

  /**
   * Asserts that a receipt matches expected issue operation details
   */
  static expectIssueReceipt(
    receipt: LedgerAPI["schemas"]["receipt"],
    expected: {
      asset: LedgerAPI["schemas"]["asset"];
      quantity: number;
      destinationFinId: string;
    }
  ) {
    expect(receipt.asset).toStrictEqual(expected.asset);
    expect(parseInt(receipt.quantity)).toBe(expected.quantity);
    expect(receipt.destination?.finId).toBe(expected.destinationFinId);
    expect(receipt.operationType).toBe("issue");
  }

  /**
   * Asserts that a receipt matches expected transfer operation details
   */
  static expectTransferReceipt(
    receipt: LedgerAPI["schemas"]["receipt"],
    expected: {
      asset: LedgerAPI["schemas"]["asset"];
      quantity: number;
      sourceFinId: string;
      destinationFinId: string;
    }
  ) {
    expect(receipt.asset).toStrictEqual(expected.asset);
    expect(parseInt(receipt.quantity)).toBe(expected.quantity);
    expect(receipt.source?.finId).toBe(expected.sourceFinId);
    expect(receipt.destination?.finId).toBe(expected.destinationFinId);
    expect(receipt.operationType).toBe("transfer");
  }

  /**
   * Asserts that a receipt matches expected hold operation details
   */
  static expectHoldReceipt(
    receipt: LedgerAPI["schemas"]["receipt"],
    expected: {
      asset: LedgerAPI["schemas"]["asset"];
      quantity: number;
      sourceFinId: string;
      destinationShouldBeUndefined?: boolean;
    }
  ) {
    expect(receipt.asset).toStrictEqual(expected.asset);
    expect(parseFloat(receipt.quantity)).toBeCloseTo(expected.quantity, 4);
    expect(receipt.source?.finId).toBe(expected.sourceFinId);

    if (expected.destinationShouldBeUndefined !== false) {
      expect(receipt.destination).toBeUndefined();
    }

    expect(receipt.operationType).toBe("hold");
  }

  /**
   * Asserts that a receipt matches expected release operation details
   */
  static expectReleaseReceipt(
    receipt: LedgerAPI["schemas"]["receipt"],
    expected: {
      asset: LedgerAPI["schemas"]["asset"];
      quantity: number;
      sourceFinId: string;
      destinationFinId: string;
    }
  ) {
    expect(receipt.asset).toStrictEqual(expected.asset);
    expect(parseFloat(receipt.quantity)).toBeCloseTo(expected.quantity, 4);
    expect(receipt.source?.finId).toBe(expected.sourceFinId);
    expect(receipt.destination?.finId).toBe(expected.destinationFinId);
    expect(receipt.operationType).toBe("release");
  }

  /**
   * Asserts that a receipt matches expected redeem operation details
   */
  static expectRedeemReceipt(
    receipt: LedgerAPI["schemas"]["receipt"],
    expected: {
      asset: LedgerAPI["schemas"]["asset"];
      quantity: number;
      sourceFinId: string;
    }
  ) {
    expect(receipt.asset).toStrictEqual(expected.asset);
    expect(parseFloat(receipt.quantity)).toBeCloseTo(expected.quantity, 4);
    expect(receipt.source?.finId).toBe(expected.sourceFinId);
    expect(receipt.destination).toBeUndefined();
    expect(receipt.operationType).toBe("redeem");
  }

  /**
   * Asserts that an operation status has no errors
   */
  static expectNoErrors(status: any) {
    expect(status.error).toBeUndefined();
  }
}

/**
 * Helper class for balance assertions
 */
export class BalanceAssertions {

  /**
   * Asserts that an actor has the expected balance for an asset
   */
  static async expectBalance(
    client: any,
    actor: TestActor,
    asset: LedgerAPI["schemas"]["asset"],
    expectedAmount: number
  ) {
    await client.expectBalance(actor.source, asset, expectedAmount);
  }

  /**
   * Asserts multiple balances at once
   */
  static async expectBalances(
    client: any,
    balances: Array<{
      actor: TestActor;
      asset: LedgerAPI["schemas"]["asset"];
      amount: number;
    }>
  ) {
    for (const { actor, asset, amount } of balances) {
      await client.expectBalance(actor.source, asset, amount);
    }
  }
}

/**
 * Helper class for common test patterns
 */
export class TestHelpers {

  /**
   * Waits for an operation to complete and returns the response
   */
  static async waitForCompletion(client: any, status: any) {
    if (!status.isCompleted) {
      await client.common.waitForCompletion(status.cid);
    }
  }

  /**
   * Expects a receipt from a status, waiting if necessary
   */
  static async expectReceipt(client: any, status: any): Promise<LedgerAPI["schemas"]["receipt"]> {
    return await client.expectReceipt(status);
  }

  /**
   * Creates an asset and waits for completion
   */
  static async createAssetAndWait(
    client: any,
    request: LedgerAPI["schemas"]["CreateAssetRequest"]
  ) {
    const status = await client.tokens.createAsset(request);
    await TestHelpers.waitForCompletion(client, status);
    return status;
  }

  /**
   * Issues tokens and waits for receipt
   */
  static async issueAndGetReceipt(
    client: any,
    request: LedgerAPI["schemas"]["IssueAssetsRequest"]
  ): Promise<LedgerAPI["schemas"]["receipt"]> {
    const status = await client.tokens.issue(request);
    return await TestHelpers.expectReceipt(client, status);
  }

  /**
   * Transfers tokens and waits for receipt
   */
  static async transferAndGetReceipt(
    client: any,
    request: LedgerAPI["schemas"]["TransferAssetRequest"]
  ): Promise<LedgerAPI["schemas"]["receipt"]> {
    const status = await client.tokens.transfer(request);
    return await TestHelpers.expectReceipt(client, status);
  }

  /**
   * Holds assets in escrow and waits for receipt
   */
  static async holdAndGetReceipt(
    client: any,
    request: LedgerAPI["schemas"]["HoldOperationRequest"]
  ): Promise<LedgerAPI["schemas"]["receipt"]> {
    const status = await client.escrow.hold(request);
    return await TestHelpers.expectReceipt(client, status);
  }

  /**
   * Releases escrowed assets and waits for receipt
   */
  static async releaseAndGetReceipt(
    client: any,
    request: LedgerAPI["schemas"]["ReleaseOperationRequest"]
  ): Promise<LedgerAPI["schemas"]["receipt"]> {
    const status = await client.escrow.release(request);
    return await TestHelpers.expectReceipt(client, status);
  }

  /**
   * Redeems tokens and waits for receipt
   */
  static async redeemAndGetReceipt(
    client: any,
    request: LedgerAPI["schemas"]["RedeemAssetsRequest"]
  ): Promise<LedgerAPI["schemas"]["receipt"]> {
    const status = await client.tokens.redeem(request);
    return await TestHelpers.expectReceipt(client, status);
  }
}

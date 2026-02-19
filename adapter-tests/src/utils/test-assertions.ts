import { LedgerAPI } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { LedgerAPIClient } from '../api/api';
import { sleep } from './utils';
import { ClientError } from './error';

/**
 * Helper class for common receipt assertions
 * Reduces boilerplate and makes test failures more descriptive
 */
export class ReceiptAssertions {

  /**
   * Asserts that a receipt matches expected issue operation details
   */
  static expectIssueReceipt(
    receipt: LedgerAPI['schemas']['receipt'],
    expected: {
      asset: LedgerAPI['schemas']['asset'];
      quantity: number;
      destinationFinId: string;
    },
  ) {
    expect(receipt.asset).toStrictEqual(expected.asset);
    expect(parseInt(receipt.quantity)).toBe(expected.quantity);
    expect(receipt.destination?.finId).toBe(expected.destinationFinId);
    expect(receipt.operationType).toBe('issue');
  }

  /**
   * Asserts that a receipt matches expected transfer operation details
   */
  static expectTransferReceipt(
    receipt: LedgerAPI['schemas']['receipt'],
    expected: {
      asset: LedgerAPI['schemas']['asset'];
      quantity: number;
      sourceFinId: string;
      destinationFinId: string;
    },
  ) {
    expect(receipt.asset).toStrictEqual(expected.asset);
    expect(parseInt(receipt.quantity)).toBe(expected.quantity);
    expect(receipt.source?.finId).toBe(expected.sourceFinId);
    expect(receipt.destination?.finId).toBe(expected.destinationFinId);
    expect(receipt.operationType).toBe('transfer');
  }

  /**
   * Asserts that a receipt matches expected hold operation details
   */
  static expectHoldReceipt(
    receipt: LedgerAPI['schemas']['receipt'],
    expected: {
      asset: LedgerAPI['schemas']['asset'];
      quantity: number;
      sourceFinId: string;
      destinationShouldBeUndefined?: boolean;
    },
  ) {
    expect(receipt.asset).toStrictEqual(expected.asset);
    expect(parseFloat(receipt.quantity)).toBeCloseTo(expected.quantity, 4);
    expect(receipt.source?.finId).toBe(expected.sourceFinId);

    if (expected.destinationShouldBeUndefined !== false) {
      expect(receipt.destination).toBeUndefined();
    }

    expect(receipt.operationType).toBe('hold');
  }

  /**
   * Asserts that a receipt matches expected release operation details
   */
  static expectReleaseReceipt(
    receipt: LedgerAPI['schemas']['receipt'],
    expected: {
      asset: LedgerAPI['schemas']['asset'];
      quantity: number;
      sourceFinId: string;
      destinationFinId: string;
    },
  ) {
    expect(receipt.asset).toStrictEqual(expected.asset);
    expect(parseFloat(receipt.quantity)).toBeCloseTo(expected.quantity, 4);
    expect(receipt.source?.finId).toBe(expected.sourceFinId);
    expect(receipt.destination?.finId).toBe(expected.destinationFinId);
    expect(receipt.operationType).toBe('release');
  }

  /**
   * Asserts that a receipt matches expected redeem operation details
   */
  static expectRedeemReceipt(
    receipt: LedgerAPI['schemas']['receipt'],
    expected: {
      asset: LedgerAPI['schemas']['asset'];
      quantity: number;
      sourceFinId: string;
    },
  ) {
    expect(receipt.asset).toStrictEqual(expected.asset);
    expect(parseFloat(receipt.quantity)).toBeCloseTo(expected.quantity, 4);
    expect(receipt.source?.finId).toBe(expected.sourceFinId);
    expect(receipt.destination).toBeUndefined();
    expect(receipt.operationType).toBe('redeem');
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
    client: LedgerAPIClient,
    finId: string,
    assetId: string,
    expectedAmount: number,
  ) {
    await client.expectBalance(
      { finId, account: { type: 'finId', finId } },
      { type: 'finp2p', resourceId: assetId },
      expectedAmount,
    );
  }

  /**
   * Asserts multiple balances at once
   */
  static async expectBalances(
    client: LedgerAPIClient,
    balances: Array<{
      finId: string;
      assetId: string;
      amount: number;
    }>,
  ) {
    for (const { finId, assetId, amount } of balances) {
      await this.expectBalance(client, finId, assetId, amount);
    }
  }
}

/**
 * Helper class for common test patterns
 */
export class TestHelpers {
  /**
   * Creates an asset and waits for completion
   */
  static async createAssetAndWait(
    client: LedgerAPIClient,
    request: LedgerAPI['schemas']['CreateAssetRequest'],
  ): Promise<LedgerAPI['schemas']['CreateAssetResponse']> {
    return this.executeAndWaitForCompletion(client, () => client.tokens.createAsset(request));
  }

  /**
   * Issues tokens and waits for receipt
   */
  static async issueAndGetReceipt(
    client: LedgerAPIClient,
    request: LedgerAPI['schemas']['IssueAssetsRequest'],
  ): Promise<LedgerAPI['schemas']['receipt']> {
    return this.executeAndWaitForReceipt(client, () => client.tokens.issue(request));
  }

  /**
   * Transfers tokens and waits for receipt
   */
  static async transferAndGetReceipt(
    client: LedgerAPIClient,
    request: LedgerAPI['schemas']['TransferAssetRequest'],
  ): Promise<LedgerAPI['schemas']['receipt']> {
    return this.executeAndWaitForReceipt(client, () => client.tokens.transfer(request));
  }

  /**
   * Holds assets in escrow and waits for receipt
   */
  static async holdAndGetReceipt(
    client: LedgerAPIClient,
    request: LedgerAPI['schemas']['HoldOperationRequest'],
  ): Promise<LedgerAPI['schemas']['receipt']> {
    return this.executeAndWaitForReceipt(client, () => client.escrow.hold(request));
  }

  /**
   * Releases escrowed assets and waits for receipt
   */
  static async releaseAndGetReceipt(
    client: LedgerAPIClient,
    request: LedgerAPI['schemas']['ReleaseOperationRequest'],
  ): Promise<LedgerAPI['schemas']['receipt']> {
    return this.executeAndWaitForReceipt(client, () => client.escrow.release(request));
  }

  /**
   * Redeems tokens and waits for receipt
   */
  static async redeemAndGetReceipt(
    client: LedgerAPIClient,
    request: LedgerAPI['schemas']['RedeemAssetsRequest'],
  ): Promise<LedgerAPI['schemas']['receipt']> {
    return this.executeAndWaitForReceipt(client, () => client.tokens.redeem(request));
  }

  /**
   * Executes the operation and waits the operation to complete
   */
  static async executeAndWaitForCompletion<R extends LedgerAPI['schemas']['OperationBase']>(
    client: LedgerAPIClient,
    request: () => Promise<R>,
  ): Promise<R> {
    const operation = await request();
    if (operation.isCompleted === true) {
      return operation;
    }

    if (operation.operationMetadata?.operationResponseStrategy?.type === 'callback') {
      client.callbackServer!.expectLater(operation.cid);
      return client.callbackServer!.operation(operation.cid) as Promise<R>;
    }

    for (let i = 1; i < 3000; i++) {
      const status = await client.common.getOperationStatus(operation.cid);
      if (status.operation.isCompleted) {
        return status.operation as R;
      }
      await sleep(500);
    }

    throw new ClientError(`no result after ${3000} retries`);
  }

  /**
   * Executes the operations and waits the operation to complete with receipt
   */
  static async executeAndWaitForReceipt<R extends LedgerAPI['schemas']['OperationBase'] & { response?: { id: string } }>(
    client: LedgerAPIClient,
    request: () => Promise<R>,
  ): Promise<LedgerAPI['schemas']['receipt']> {
    const result = await this.executeAndWaitForCompletion(client, request);
    if (!result.response) {
      throw new ClientError('response object is empty');
    }

    const receipt = await client.common.getReceipt(result.response.id);
    return receipt.response!;
  }
}

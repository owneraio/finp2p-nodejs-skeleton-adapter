import {
  Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetIdentifier,
  Balance, Destination, ExecutionContext, FinIdAccount,
  ReceiptOperation, Signature, Source,
  TokenService,
  failedReceiptOperation, finIdDestination, successfulAssetCreation, successfulReceiptOperation,
} from '@owneraio/finp2p-adapter-models';
import { ExternalTransferDelegate } from './interfaces';
import { LedgerStorage } from './storage';
import { ReceiptBuilder } from './receipt-builder';
import { logger } from './logger';
import { generateCid } from './utils';

export class TokenServiceImpl implements TokenService {
  constructor(
    private storage: LedgerStorage,
    private delegate: ExternalTransferDelegate,
    private receiptBuilder: ReceiptBuilder,
  ) {}

  async createAsset(
    idempotencyKey: string, asset: Asset,
    assetBind: AssetBind | undefined, assetMetadata: any | undefined,
    assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined,
  ): Promise<AssetCreationStatus> {
    logger.info(`Creating asset ${asset.assetId}`, { idempotencyKey });

    if (this.delegate.onAssetCreated) {
      const result = await this.delegate.onAssetCreated(idempotencyKey, asset, assetBind, assetMetadata);
      return successfulAssetCreation(result);
    }

    const tokenId = assetBind?.tokenIdentifier?.tokenId ?? generateCid();
    return successfulAssetCreation({ tokenId, reference: undefined });
  }

  async issue(
    idempotencyKey: string, asset: Asset, to: FinIdAccount,
    quantity: string, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info(`Issuing ${quantity} of ${asset.assetId} to ${to.finId}`);

    await this.storage.ensureAccount(to.finId, asset.assetId, asset.assetType);
    const tx = await this.storage.credit(to.finId, quantity, asset.assetId, {
      idempotency_key: idempotencyKey,
      operation_type: 'issue',
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    }, asset.assetType);

    const receipt = await this.receiptBuilder.build(
      tx, asset, undefined, finIdDestination(to.finId), quantity, 'issue', exCtx, undefined,
    );
    return successfulReceiptOperation(receipt);
  }

  async transfer(
    idempotencyKey: string, nonce: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, signature: Signature, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info(`Transferring ${quantity} of ${asset.assetId} from ${source.finId} to ${destination.finId}`);

    const details = {
      idempotency_key: idempotencyKey,
      operation_type: 'transfer' as const,
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    };

    if (destination.account.type === 'finId') {
      await this.storage.ensureAccount(destination.finId, asset.assetId, asset.assetType);
      const tx = await this.storage.move(source.finId, destination.finId, quantity, asset.assetId, details, asset.assetType);
      const receipt = await this.receiptBuilder.build(
        tx, asset, source, destination, quantity, 'transfer', exCtx, undefined,
      );
      return successfulReceiptOperation(receipt);
    }

    // External destination: debit source in DB, delegate external transfer
    const tx = await this.storage.debit(source.finId, quantity, asset.assetId, details, asset.assetType);
    const extResult = await this.delegate.executeExternalTransfer(
      idempotencyKey, source, destination, asset, quantity, exCtx,
    );
    const receipt = await this.receiptBuilder.build(
      tx, asset, source, destination, quantity, 'transfer', exCtx, undefined, extResult.transactionId,
    );
    return successfulReceiptOperation(receipt);
  }

  async redeem(
    idempotencyKey: string, nonce: string, source: FinIdAccount, asset: Asset,
    quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info(`Redeeming ${quantity} of ${asset.assetId} from ${source.finId}`);

    const details = {
      idempotency_key: idempotencyKey,
      operation_id: operationId,
      operation_type: 'redeem' as const,
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    };

    const tx = operationId
      ? await this.storage.unlockAndDebit(source.finId, quantity, asset.assetId, details, asset.assetType)
      : await this.storage.debit(source.finId, quantity, asset.assetId, details, asset.assetType);

    const receipt = await this.receiptBuilder.build(
      tx, asset, { finId: source.finId, account: source }, undefined, quantity, 'redeem', exCtx, operationId,
    );
    return successfulReceiptOperation(receipt);
  }

  async getBalance(asset: Asset, finId: string): Promise<string> {
    const bal = await this.storage.getBalance(finId, asset.assetId, asset.assetType);
    return bal.available;
  }

  async balance(asset: Asset, finId: string): Promise<Balance> {
    const bal = await this.storage.getBalance(finId, asset.assetId, asset.assetType);
    return {
      current: bal.balance,
      available: bal.available,
      held: bal.held,
    };
  }
}

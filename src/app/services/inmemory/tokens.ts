import {v4 as uuid} from 'uuid';
import {CommonServiceImpl} from './common';
import {
  AssetBind,
  AssetDenomination,
  AssetIdentifier,
  FinIdAccount,
  finIdDestination,
  TokenService
} from '../../../lib/services';
import {
  Asset, AssetCreationStatus, Balance, Destination, ExecutionContext, ReceiptOperation,
  Signature, Source, successfulAssetCreation,
  successfulReceiptOperation,
} from '../../../lib/services';
import {logger} from '../../../lib/helpers';
import {Transaction} from './model';

export class TokenServiceImpl extends CommonServiceImpl implements TokenService {

  public async createAsset(idempotencyKey: string, asset: Asset,
                           assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
                           assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined): Promise<AssetCreationStatus> {
    logger.info(`Creating asset ${asset.assetId}`, {
      idempotencyKey,
      assetBind,
      assetMetadata,
      assetName,
      issuerId,
      assetDenomination,
      assetIdentifier
    });
    let tokenId: string
    if (!assetBind || !assetBind.tokenIdentifier) {
      tokenId = uuid();
    } else {
      ({tokenIdentifier: {tokenId}} = assetBind);
    }
    return successfulAssetCreation({ tokenId, reference: undefined });
  }

  public async balance(assetId: string, finId: string): Promise<Balance> {
    const balance = this.accountService.getBalance(finId, assetId);
    return {
      current: balance,
      available: balance,
      held: '0.00',
    } as Balance;
  }

  public async getBalance(assetId: string, finId: string): Promise<string> {
    return this.accountService.getBalance(finId, assetId);
  }

  public async issue(idempotencyKey: string, asset: Asset, to: FinIdAccount, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const {finId} = to;
    logger.info(`Issuing ${quantity} of ${asset.assetId} to ${finId}`);

    this.accountService.credit(finId, quantity, asset.assetId);
    const tx = new Transaction(quantity, asset, undefined, finIdDestination(finId), exCtx, 'issue', undefined);
    this.registerTransaction(tx);
    return successfulReceiptOperation(tx.toReceipt());
  }

  public async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, asset: Asset,
                        quantity: string, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {

    logger.info(`Transferring ${quantity} of ${asset.assetId} from ${source.finId} to ${destination.finId}`);

    this.accountService.move(source.finId, destination.finId, quantity, asset.assetId);
    const tx = new Transaction(quantity, asset, source.account, destination, exCtx, 'transfer', undefined);
    this.registerTransaction(tx);
    return successfulReceiptOperation(tx.toReceipt());
  }

  public async redeem(idempotencyKey: string, nonce: string, source: FinIdAccount, asset: Asset, quantity: string, operationId: string | undefined,
                      signature: Signature, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info(`Redeeming ${quantity} of ${asset.assetId} from ${source.finId}`);

    this.accountService.debit(source.finId, quantity, asset.assetId);
    const tx = new Transaction(quantity, asset, source, undefined, exCtx, 'redeem', operationId);
    this.registerTransaction(tx);
    return successfulReceiptOperation(tx.toReceipt());
  }

}


import { v4 as uuid } from 'uuid';
import { CommonServiceImpl } from './common';
import { TokenService } from '../interfaces';
import {
  Asset, AssetCreationStatus, Balance, Destination, ExecutionContext, Receipt, ReceiptOperation,
  Signature, Source, successfulAssetCreation,
  successfulReceiptOperation,
} from '../model';
import { logger } from '../../helpers/logger';
import { Transaction } from './model';

export class TokenServiceImpl extends CommonServiceImpl implements TokenService {

  public async createAsset(assetId: string, tokenId: string | undefined): Promise<AssetCreationStatus> {
    logger.info('Creating asset', assetId);
    if (!tokenId) {
      tokenId = uuid();
    }
    return successfulAssetCreation(tokenId, '', '');
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

  public async issue(asset: Asset, issuerFinId: string, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {

    logger.info(`Issuing ${quantity} of ${asset.assetId} to ${issuerFinId}`);

    this.accountService.credit(issuerFinId, quantity, asset.assetId);
    const destination = { finId: issuerFinId } as Destination;
    const tx = new Transaction(quantity, asset, undefined, destination, exCtx, 'issue', undefined);
    this.registerTransaction(tx);
    return successfulReceiptOperation(tx.toReceipt());
  }

  public async transfer(nonce: string, source: Source, destination: Destination, asset: Asset,
    quantity: string, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {

    logger.info(`Transferring ${quantity} of ${asset.assetId} from ${source.finId} to ${destination.finId}`);

    this.accountService.move(source.finId, destination.finId, quantity, asset.assetId);
    const tx = new Transaction(quantity, asset, source, destination, exCtx, 'transfer', undefined);
    this.registerTransaction(tx);
    return successfulReceiptOperation(tx.toReceipt());
  }

  public async redeem(nonce: string, source: Source, asset: Asset, quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info(`Redeeming ${quantity} of ${asset.assetId} from ${source.finId}`);

    this.accountService.debit(source.finId, quantity, asset.assetId);
    const tx = new Transaction(quantity, asset, source, undefined, exCtx, 'redeem', operationId);
    this.registerTransaction(tx);
    return successfulReceiptOperation(tx.toReceipt());
  }

}


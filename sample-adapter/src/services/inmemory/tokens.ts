import { CommonServiceImpl } from './common';
import {
  AssetBind, AssetCreationStatus,
  AssetDenomination,
  AssetIdentifier, Balance, BusinessError, Destination, failedReceiptOperation,
  FinIdAccount,
  finIdDestination, ReceiptOperation, Source, successfulAssetCreation, successfulReceiptOperation,
  TokenService,
  Asset, ExecutionContext,
  Signature,
} from '@owneraio/finp2p-adapter-models';
import { ProofProvider } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { Transaction } from './model';
import { Storage } from './storage';
import { generateId } from './utils';

export class TokenServiceImpl extends CommonServiceImpl implements TokenService {

  proofProvider: ProofProvider | undefined;

  constructor(storage: Storage, proofProvider: ProofProvider | undefined) {
    super(storage);
    this.proofProvider = proofProvider;
  }

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
      assetIdentifier,
    });
    let tokenId: string;
    if (!assetBind || !assetBind.tokenIdentifier) {
      tokenId = generateId();
      this.storage.createAsset(asset.assetId, asset);
    } else {
      ({ tokenIdentifier: { tokenId } } = assetBind);
    }
    return successfulAssetCreation({ tokenId, reference: undefined });
  }

  public async balance(assetId: string, finId: string): Promise<Balance> {
    const balance = this.storage.getBalance(finId, assetId);
    return {
      current: balance,
      available: balance,
      held: '0.00',
    } as Balance;
  }

  public async getBalance(assetId: string, finId: string): Promise<string> {
    return this.storage.getBalance(finId, assetId);
  }

  public async issue(idempotencyKey: string, asset: Asset, to: FinIdAccount, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const { finId } = to;
    logger.info(`Issuing ${quantity} of ${asset.assetId} to ${finId}`);

    this.storage.credit(finId, quantity, asset.assetId);
    const tx = new Transaction(quantity, asset, undefined, finIdDestination(finId), exCtx, 'issue', undefined);
    this.registerTransaction(tx);
    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

  public async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, asset: Asset,
    quantity: string, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {


    logger.info(`Transferring ${quantity} of ${asset.assetId} from ${source.finId} to ${destination.finId}`);
    const signer = source.finId;
    // if (!await verifySignature(signature, signer)) {
    //   return failedReceiptOperation(1, 'Signature verification failed');
    // }

    this.storage.move(source.finId, destination.finId, quantity, asset.assetId);
    const tx = new Transaction(quantity, asset, source.account, destination, exCtx, 'transfer', undefined);
    this.registerTransaction(tx);
    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

  public async redeem(idempotencyKey: string, nonce: string, source: FinIdAccount, asset: Asset, quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info(`Redeeming ${quantity} of ${asset.assetId} from ${source.finId}`);

    const signer = source.finId;
    // if (!await verifySignature(signature, signer)) {
    //   return failedReceiptOperation(1, 'Signature verification failed');
    // }

    if (operationId) {
      const hold = this.storage.getHoldOperation(operationId);
      if (hold === undefined) {
        throw new BusinessError(1, `unknown operation: ${operationId}`);
      }
      // do no movement, account is effected at hold time
      this.storage.removeHoldOperation(operationId);
    } else {
      this.storage.debit(source.finId, quantity, asset.assetId);
    }

    const tx = new Transaction(quantity, asset, source, undefined, exCtx, 'redeem', operationId);
    this.registerTransaction(tx);
    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

}


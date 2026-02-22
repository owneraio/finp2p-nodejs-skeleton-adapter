import { CommonServiceImpl } from './common';
import {
  AssetBind, AssetCreationStatus,
  AssetDenomination,
  Balance, BusinessError, Destination,
  FinIdAccount,
  LedgerAssetIdentifier, ReceiptOperation, Source, successfulAssetCreation, successfulReceiptOperation,
  TokenService,
  Asset, ExecutionContext,
  Signature,
} from '@owneraio/finp2p-adapter-models';
import { logger, ProofProvider } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { Transaction } from './model';
import { Storage } from './storage';
import {
  generateId,
} from './utils';

export class TokenServiceImpl extends CommonServiceImpl implements TokenService {

  proofProvider: ProofProvider | undefined;

  constructor(storage: Storage, proofProvider: ProofProvider | undefined) {
    super(storage);
    this.proofProvider = proofProvider;
  }

  public async createAsset(idempotencyKey: string, asset: Asset,
    assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus> {
    logger.info(`Creating asset ${asset.assetId}`, {
      idempotencyKey,
      assetBind,
      assetMetadata,
      assetName,
      issuerId,
      assetDenomination,
    });
    let ledgerIdentifier: LedgerAssetIdentifier;
    if (!assetBind || !assetBind.tokenIdentifier) {
      ledgerIdentifier = { network: '', tokenId: generateId(), standard: '' };
      this.storage.createAsset(asset.assetId, asset);
    } else {
      const { network, tokenId, standard } = assetBind.tokenIdentifier;
      ledgerIdentifier = { network, tokenId, standard };
    }
    return successfulAssetCreation({ ledgerIdentifier, reference: undefined });
  }

  public async balance(asset: Asset, finId: string): Promise<Balance> {
    const balance = this.storage.getBalance(finId, asset.assetId);
    return {
      current: balance,
      available: balance,
      held: '0.00',
    } as Balance;
  }

  public async getBalance(asset: Asset, finId: string): Promise<string> {
    return this.storage.getBalance(finId, asset.assetId);
  }

  public async issue(idempotencyKey: string, asset: Asset, to: Destination, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const { finId } = to;
    logger.info(`Issuing ${quantity} of ${asset.assetId} to ${finId}`);

    this.storage.credit(finId, quantity, asset.assetId);
    const tx = new Transaction(quantity, asset, undefined, to, exCtx, 'issue', undefined);
    this.registerTransaction(tx);
    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

  public async doesSupportCrosschainTransfer(sourceAsset: Asset, destinationAsset: Asset): Promise<boolean> {
    return false;
  }

  public async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination,
    sourceAsset: Asset, destinationAsset: Asset,
    quantity: string, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {

    logger.info(`Transferring ${quantity} of ${sourceAsset.assetId} from ${source.finId} to ${destination.finId}`);
    // const signer = source.finId;
    // if (!await verifySignature(signature, signer)) {
    //   return failedReceiptOperation(1, 'Signature verification failed');
    // }

    this.storage.move(source.finId, destination.finId, quantity, sourceAsset.assetId);
    const tx = new Transaction(quantity, sourceAsset, source, destination, exCtx, 'transfer', undefined);
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

    const sourceAccount: Source = { finId: source.finId, account: source };
    const tx = new Transaction(quantity, asset, sourceAccount, undefined, exCtx, 'redeem', operationId);
    this.registerTransaction(tx);
    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }
}


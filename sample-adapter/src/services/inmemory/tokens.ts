import { CommonServiceImpl } from './common';
import {
  AssetBind, AssetCreationStatus,
  AssetDenomination,
  Balance, BusinessError, Destination,
  LedgerAssetIdentifier, ReceiptOperation, Source, successfulAssetCreation, successfulReceiptOperation,
  TokenService,
  Asset, ExecutionContext,
  Signature,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
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

  public async createAsset(idempotencyKey: string, assetId: string,
    assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus> {
    logger.info(`Creating asset ${assetId}`, {
      idempotencyKey,
      assetBind,
      assetMetadata,
      assetName,
      issuerId,
      assetDenomination,
    });
    let ledgerIdentifier: LedgerAssetIdentifier;
    if (!assetBind || !assetBind.tokenIdentifier) {
      ledgerIdentifier = { assetIdentifierType: 'CAIP-19', network: 'inmemory', tokenId: generateId(), standard: 'mock' };
    } else {
      const { network, tokenId, standard } = assetBind.tokenIdentifier;
      ledgerIdentifier = { assetIdentifierType: 'CAIP-19', network, tokenId, standard };
    }
    const asset: Asset = { assetId, assetType: 'finp2p', ledgerIdentifier };
    this.storage.createAsset(assetId, asset);
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

  public async issue(idempotencyKey: string, asset: Asset, destinationFinId: string, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    logger.info(`Issuing ${quantity} of ${asset.assetId} to ${destinationFinId}`);

    this.storage.credit(destinationFinId, quantity, asset.assetId);
    const destination: Destination = { finId: destinationFinId };
    const tx = new Transaction(quantity, asset, undefined, destination, exCtx, 'issue', undefined);
    this.storage.registerTransaction(tx);
    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

  public async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination,
    asset: Asset,
    quantity: string, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {

    logger.info(`Transferring ${quantity} of ${asset.assetId} from ${source.finId} to ${destination.finId}`);

    this.storage.move(source.finId, destination.finId, quantity, asset.assetId);
    const tx = new Transaction(quantity, asset, source, destination, exCtx, 'transfer', undefined);
    this.storage.registerTransaction(tx);
    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

  public async redeem(idempotencyKey: string, nonce: string, sourceFinId: string, asset: Asset, quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info(`Redeeming ${quantity} of ${asset.assetId} from ${sourceFinId}`);

    // if (!await verifySignature(signature, sourceFinId)) {
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
      this.storage.debit(sourceFinId, quantity, asset.assetId);
    }

    const source: Source = { finId: sourceFinId };
    const tx = new Transaction(quantity, asset, source, undefined, exCtx, 'redeem', operationId);
    this.storage.registerTransaction(tx);
    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }
}


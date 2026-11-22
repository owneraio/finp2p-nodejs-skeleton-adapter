import { CommonServiceImpl } from './common';
import {
  AssetBind, AssetCreationStatus,
  AssetDenomination,
  Balance, BusinessError, Destination,
  LedgerAssetIdentifier, ReceiptOperation, Source, failedAssetCreation, successfulAssetCreation, successfulReceiptOperation,
  TokenService,
  Asset, ExecutionContext,
  Signature, SwapLeg, SwapOperation, failedSwapOperation, successfulSwapOperation,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { logger, ProofProvider } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { Transaction } from './model';
import { Storage } from './storage';
import {
  generateId,
} from './utils';

const SUPPORTED_NETWORK = 'inmemory';
const SUPPORTED_STANDARD = 'mock';

/** LedgerBindingNotSupportedErr — the ledger does not support the requested network/standard. */
const LEDGER_BINDING_NOT_SUPPORTED = 7311;

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
    const network = assetBind?.network ?? SUPPORTED_NETWORK;
    const standard = assetBind?.standard ?? SUPPORTED_STANDARD;
    if (network !== SUPPORTED_NETWORK || standard !== SUPPORTED_STANDARD) {
      return failedAssetCreation(LEDGER_BINDING_NOT_SUPPORTED,
        `unsupported ledger binding ${network}/${standard}, only ${SUPPORTED_NETWORK}/${SUPPORTED_STANDARD} is supported`);
    }
    const tokenId = assetBind?.tokenId ?? generateId();
    const ledgerIdentifier: LedgerAssetIdentifier = { assetIdentifierType: 'CAIP-19', network, tokenId, standard };
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

  public async issue(idempotencyKey: string, asset: Asset, destination: Destination, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    logger.info(`Issuing ${quantity} of ${asset.assetId} to ${destination.finId}`);

    this.storage.credit(destination.finId, quantity, asset.assetId);
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

  public async swap(idempotencyKey: string, nonce: string, operationId: string, asset: SwapLeg, settlement: SwapLeg,
    numberOfReceipts: number, deadline: number, exCtx: ExecutionContext | undefined,
  ): Promise<SwapOperation> {
    logger.info(`Swapping ${asset.quantity} of ${asset.asset.assetId} for ${settlement.quantity} of ${settlement.asset.assetId}`, { operationId, numberOfReceipts });

    if (numberOfReceipts !== 1 && numberOfReceipts !== 2) {
      return failedSwapOperation(1, `numberOfReceipts must be 1 or 2, got ${numberOfReceipts}`);
    }
    if (numberOfReceipts === 2 && !settlement.signature) {
      return failedSwapOperation(1, 'settlement leg signature is required');
    }
    if (deadline && deadline <= Math.floor(Date.now() / 1000)) {
      return failedSwapOperation(1, `swap deadline ${deadline} has already passed`);
    }

    this.storage.move(asset.source.finId, asset.destination.finId, asset.quantity, asset.asset.assetId);
    if (numberOfReceipts === 2) {
      try {
        this.storage.move(settlement.source.finId, settlement.destination.finId, settlement.quantity, settlement.asset.assetId);
      } catch (e: any) {
        this.storage.move(asset.destination.finId, asset.source.finId, asset.quantity, asset.asset.assetId);
        return failedSwapOperation(1, e?.message ?? String(e));
      }
    }

    const assetTx = new Transaction(asset.quantity, asset.asset, asset.source, asset.destination, exCtx, 'swap', operationId);
    this.storage.registerTransaction(assetTx);
    if (numberOfReceipts === 1) {
      return successfulSwapOperation(await this.proven(assetTx));
    }
    // receiptToAPI reads counterpartyAssetId for the destination asset; the settlement leg sees them swapped
    const settlementExCtx = exCtx && {
      ...exCtx, counterpartyAssetId: exCtx.counterpartySettlementId, counterpartySettlementId: exCtx.counterpartyAssetId,
    };
    const settlementTx = new Transaction(settlement.quantity, settlement.asset, settlement.source, settlement.destination, settlementExCtx, 'swap', operationId, assetTx.id);
    this.storage.registerTransaction(settlementTx);
    return successfulSwapOperation(await this.proven(assetTx), await this.proven(settlementTx));
  }

  private async proven(tx: Transaction) {
    const receipt = tx.toReceipt();
    return this.proofProvider ? this.proofProvider.ledgerProof(receipt) : receipt;
  }

  public async redeem(idempotencyKey: string, nonce: string, source: Source, asset: Asset, quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info(`Redeeming ${quantity} of ${asset.assetId} from ${source.finId}`);

    // if (!await verifySignature(signature, source.finId)) {
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
    this.storage.registerTransaction(tx);
    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }
}


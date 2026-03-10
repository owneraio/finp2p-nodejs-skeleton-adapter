import {
  Asset, Destination, EscrowService, ExecutionContext,
  ReceiptOperation, Signature, Source,
  finIdDestination, successfulReceiptOperation,
} from '@owneraio/finp2p-adapter-models';
import { ExternalTransferDelegate } from './interfaces';
import { LedgerStorage } from './storage';
import { ReceiptBuilder } from './receipt-builder';
import { logger } from './logger';

export class EscrowServiceImpl implements EscrowService {
  constructor(
    private storage: LedgerStorage,
    private delegate: ExternalTransferDelegate,
    private receiptBuilder: ReceiptBuilder,
  ) {}

  async hold(
    idempotencyKey: string, nonce: string, source: Source,
    destination: Destination | undefined, asset: Asset,
    quantity: string, signature: Signature, operationId: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info('Hold operation', { source: source.finId, asset: asset.assetId, quantity, operationId });

    const tx = await this.storage.lock(source.finId, quantity, asset.assetId, {
      idempotency_key: idempotencyKey,
      operation_id: operationId,
      operation_type: 'hold',
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    }, asset.assetType);

    const receipt = this.receiptBuilder.build(
      tx, asset, source, destination, quantity, 'hold', exCtx, operationId,
    );
    return successfulReceiptOperation(receipt);
  }

  async release(
    idempotencyKey: string, source: Source, destination: Destination,
    asset: Asset, quantity: string, operationId: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info('Release operation', { source: source.finId, destination: destination.finId, quantity, operationId });

    const details = {
      idempotency_key: idempotencyKey,
      operation_id: operationId,
      operation_type: 'release' as const,
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    };

    if (destination.account.type === 'finId') {
      // Internal: unlock source held, credit destination
      await this.storage.ensureAccount(destination.finId, asset.assetId, asset.assetType);
      const tx = await this.storage.unlockAndMove(
        source.finId, destination.finId, quantity, asset.assetId, details, asset.assetType,
      );
      const receipt = this.receiptBuilder.build(
        tx, asset, source, destination, quantity, 'release', exCtx, operationId,
      );
      return successfulReceiptOperation(receipt);
    }

    // External destination (crypto/IBAN): unlock and debit, then delegate
    const tx = await this.storage.unlockAndDebit(
      source.finId, quantity, asset.assetId, details, asset.assetType,
    );
    const extResult = await this.delegate.executeExternalTransfer(
      idempotencyKey, source, destination, asset, quantity, exCtx,
    );
    const receipt = this.receiptBuilder.build(
      tx, asset, source, destination, quantity, 'release', exCtx, operationId, extResult.transactionId,
    );
    return successfulReceiptOperation(receipt);
  }

  async rollback(
    idempotencyKey: string, source: Source, asset: Asset,
    quantity: string, operationId: string,
    exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info('Rollback operation', { source: source.finId, quantity, operationId });

    const tx = await this.storage.unlock(source.finId, quantity, asset.assetId, {
      idempotency_key: idempotencyKey,
      operation_id: operationId,
      operation_type: 'release',
      execution_context: exCtx ? { planId: exCtx.planId, sequence: exCtx.sequence } : undefined,
    }, asset.assetType);

    const receipt = this.receiptBuilder.build(
      tx, asset, source, undefined, quantity, 'release', exCtx, operationId,
    );
    return successfulReceiptOperation(receipt);
  }
}

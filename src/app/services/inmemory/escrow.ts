import { logger } from '../../../lib/helpers';
import { CommonServiceImpl } from './common';
import {
  Asset,
  Destination, EscrowService,
  ExecutionContext, failedReceiptOperation, ProofProvider,
  ReceiptOperation,
  Signature,
  Source,
  successfulReceiptOperation, verifySignature,
} from '../../../lib/services';

import { Transaction } from './model';
import { AccountService } from './accounts';

interface HoldOperation {
  id: string
  source: Source
  quantity: string
}

export class EscrowServiceImpl extends CommonServiceImpl implements EscrowService {

  proofProvider: ProofProvider | undefined;

  holdOperations: Record<string, HoldOperation> = {};


  constructor(accountService: AccountService, proofProvider: ProofProvider | undefined) {
    super(accountService);
    this.proofProvider = proofProvider;
  }

  public async hold(idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined, asset: Asset,
    quantity: string, signature: Signature, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {

    logger.info('Hold operation', { nonce, source, destination, asset, quantity, operationId, executionContext: exCtx });
    // const signer = source.finId;
    // if (!await verifySignature(signature, signer)) {
    //   return failedReceiptOperation(1, 'Signature verification failed');
    // }
    this.holdOperations[operationId] = {
      id: operationId,
      source,
      quantity,
    } as HoldOperation;

    this.accountService.debit(source.finId, quantity, asset.assetId);

    const tx = new Transaction(quantity, asset, source.account, undefined, exCtx, 'hold', operationId);
    this.transactions[tx.id] = tx;

    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

  public async release(idempotencyKey: string, destination: Destination, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {

    logger.info('Release hold operation', { destination, asset, quantity, operationId, executionContext: exCtx });

    const hold = this.holdOperations[operationId];
    if (hold === undefined) {
      throw new Error(`unknown operation: ${operationId}`);
    }
    const { source } = hold;

    this.accountService.credit(destination.finId, quantity, asset.assetId);

    delete this.holdOperations[operationId];

    const tx = new Transaction(quantity, asset, source.account, destination, exCtx, 'release', operationId);
    this.transactions[tx.id] = tx;

    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

  public async rollback(idempotencyKey: string, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info('Rollback hold operation', { asset, quantity, operationId, exCtx });

    const hold = this.holdOperations[operationId];
    if (hold === undefined) {
      throw new Error(`unknown operation: ${operationId}`);
    }
    const { source } = hold;
    this.accountService.credit(source.finId, quantity, asset.assetId);

    delete this.holdOperations[operationId];

    const tx = new Transaction(quantity, asset, source.account, undefined, exCtx, 'release', operationId);
    this.transactions[tx.id] = tx;

    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

}


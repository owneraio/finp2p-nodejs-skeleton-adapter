import { CommonServiceImpl } from './common';
import {
  Asset, BusinessError,
  Destination, EscrowService,
  ExecutionContext, failedReceiptOperation, FinIdAccount,
  ReceiptOperation,
  Signature,
  Source,
  successfulReceiptOperation,
} from '@owneraio/finp2p-adapter-models';

import { HoldOperation, Transaction } from './model';
import { Storage } from './storage';
import { logger, ProofProvider } from '@owneraio/finp2p-adapter-models';


export class EscrowServiceImpl extends CommonServiceImpl implements EscrowService {

  proofProvider: ProofProvider | undefined;


  constructor(accountService: Storage, proofProvider: ProofProvider | undefined) {
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
    this.storage.saveHoldOperation(operationId, source.finId, quantity);

    this.storage.debit(source.finId, quantity, asset.assetId);

    const tx = new Transaction(quantity, asset, source.account, undefined, exCtx, 'hold', operationId);
    this.transactions[tx.id] = tx;

    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

  public async release(idempotencyKey: string, source: Source, destination: Destination, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {

    logger.info('Release hold operation', { destination, asset, quantity, operationId, executionContext: exCtx });

    const hold = this.storage.getHoldOperation(operationId);
    if (hold === undefined) {
      throw new BusinessError(1, `unknown operation: ${operationId}`);
    }
    if (source.finId !== hold.finId) {
      throw new BusinessError(1, `operation ${operationId} does not belong to source ${source.finId}`);
    }
    this.storage.credit(destination.finId, quantity, asset.assetId);

    this.storage.removeHoldOperation(operationId);

    const holdSource: FinIdAccount = { type: 'finId', finId: hold.finId };
    const tx = new Transaction(quantity, asset, holdSource, destination, exCtx, 'release', operationId);
    this.transactions[tx.id] = tx;

    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

  public async rollback(idempotencyKey: string, source: Source, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined,
  ): Promise<ReceiptOperation> {
    logger.info('Rollback hold operation', { asset, quantity, operationId, exCtx });

    const hold = this.storage.getHoldOperation(operationId);
    if (hold === undefined) {
      throw new BusinessError(1, `unknown operation: ${operationId}`);
    }
    const holdSource: FinIdAccount = { type: 'finId', finId: hold.finId };
    this.storage.credit(hold.finId, quantity, asset.assetId);

    this.storage.removeHoldOperation(operationId);

    const tx = new Transaction(quantity, asset, holdSource, undefined, exCtx, 'release', operationId);
    this.transactions[tx.id] = tx;

    let receipt = tx.toReceipt();
    if (this.proofProvider) {
      receipt = await this.proofProvider.ledgerProof(receipt);
    }
    return successfulReceiptOperation(receipt);
  }

}


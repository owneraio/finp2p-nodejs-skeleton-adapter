import {logger} from '../../helpers/logger';
import {v4 as uuid} from 'uuid';
import {CommonServiceImpl} from './common';
import {
  Asset,
  Destination,
  ExecutionContext,
  ReceiptOperation,
  Signature,
  Source,
  successfulReceiptOperation
} from "../model";

import {Transaction} from "./model";
import {EscrowService} from "../interfaces";

interface HoldOperation {
  id: string
  source: Source
  quantity: string
}

export class EscrowServiceImpl extends CommonServiceImpl implements EscrowService {

  holdOperations: Record<string, HoldOperation> = {};

  public async hold(nonce: string, source: Source, destination: Destination | undefined, asset: Asset,
                    quantity: string, signature: Signature, operationId: string, executionContext: ExecutionContext
  ): Promise<ReceiptOperation> {

    logger.info('Hold operation', {nonce, source, destination, asset, quantity, operationId, executionContext});

    this.holdOperations[operationId] = {
      id: operationId,
      source,
      quantity,
    } as HoldOperation;

    this.accountService.debit(source.finId, quantity, asset.assetId);

    let tx = {
      id: uuid(),
      source,
      quantity,
      asset,
      executionContext,
      operationType: 'hold',
      operationId,
      timestamp: Date.now(),
    } as Transaction;
    this.transactions[tx.id] = tx;

    return successfulReceiptOperation(tx.toReceipt());
  }

  public async release(destination: Destination, asset: Asset, quantity: string, operationId: string, executionContext: ExecutionContext
  ): Promise<ReceiptOperation> {

    logger.info("Release hold operation", {destination, asset, quantity, operationId, executionContext});

    const hold = this.holdOperations[operationId];
    if (hold === undefined) {
      throw new Error(`unknown operation: ${operationId}`);
    }
    const {source} = hold;

    this.accountService.credit(destination.finId, quantity, asset.assetId);

    delete this.holdOperations[operationId];

    let tx = {
      id: uuid(),
      source,
      destination,
      quantity,
      asset,
      executionContext,
      operationType: 'release',
      operationId,
      timestamp: Date.now(),
    } as Transaction;
    this.transactions[tx.id] = tx;

    return successfulReceiptOperation(tx.toReceipt());
  }

  public async rollback(asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    logger.info("Rollback hold operation", {asset, quantity, operationId, exCtx});

    const hold = this.holdOperations[operationId];
    if (hold === undefined) {
      throw new Error(`unknown operation: ${operationId}`);
    }
    const {source} = hold;
    this.accountService.credit(source.finId, quantity, asset.assetId);

    delete this.holdOperations[operationId];

    let tx = {
      id: uuid(),
      source: hold.source,
      destination: source,
      quantity,
      asset,
      operationType: "release",
      operationId,
      timestamp: Date.now(),
    } as Transaction;
    this.transactions[tx.id] = tx;

    return successfulReceiptOperation(tx.toReceipt());
  }

}


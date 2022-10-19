import { logger } from '../helpers/logger';
import { v4 as uuid } from 'uuid';
import { Transaction, CommonService } from './common';
import { AccountService } from './accounts';

let service: EscrowService;

interface HoldOperation {
  id: string
  source: Components.Schemas.Source
  amount: number
  expiry: number
}

export class EscrowService extends CommonService {

  public static GetService(): EscrowService {
    if (!service) {
      service = new EscrowService();
    }
    return service;
  }

  holdOperations: Record<string, HoldOperation> = {};

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    logger.debug('hold', { request });

    const amount = parseInt(request.quantity);
    const id = AccountService.extractId(request.source);
    this.holdOperations[request.operationId] = {
      id: request.operationId,
      source: request.source,
      amount: amount,
      expiry: request.expiry,
    } as HoldOperation;

    this.accountService.debit(id, amount, request.asset);

    let tx = {
      id: uuid(),
      source: request.source,
      amount: amount,
      asset: request.asset,
      timestamp: Date.now(),
    } as Transaction;
    this.transactions[tx.id] = tx;

    return {
      isCompleted: true,
      cid: tx.id,
      response: Transaction.toReceipt(tx),
    } as Components.Schemas.ReceiptOperation;
  }

  public async release(request: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    logger.debug('release', { request });

    const hold = this.holdOperations[request.operationId];
    if (hold === undefined) {
      throw new Error(`unknown operation: ${request.operationId}`);
    }

    const amount = parseInt(request.quantity);
    const id = AccountService.extractId(request.destination);
    this.accountService.credit(id, amount, request.asset);

    let tx = {
      id: uuid(),
      source: hold.source,
      destination: request.destination,
      amount: amount,
      asset: request.asset,
      timestamp: Date.now(),
    } as Transaction;
    this.transactions[tx.id] = tx;

    return {
      isCompleted: true,
      cid: tx.id,
      response: Transaction.toReceipt(tx),
    } as Components.Schemas.ReceiptOperation;
  }

  public async rollback(request: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    logger.debug('rollback', { request });

    const hold = this.holdOperations[request.operationId];
    if (hold === undefined) {
      throw new Error(`unknown operation: ${request.operationId}`);
    }

    const amount = parseInt(request.quantity);
    const id = AccountService.extractId(request.source);
    this.accountService.credit(id, amount, request.asset);

    let tx = {
      id: uuid(),
      source: hold.source,
      destination: request.source,
      amount: amount,
      asset: request.asset,
      timestamp: Date.now(),
    } as Transaction;
    this.transactions[tx.id] = tx;

    return {
      isCompleted: true,
      cid: tx.id,
      response: Transaction.toReceipt(tx),
    } as Components.Schemas.ReceiptOperation;
  }

}


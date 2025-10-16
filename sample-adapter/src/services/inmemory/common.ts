import { Storage } from './storage';
import {
  BusinessError, CommonService, HealthService, ValidationError,
  OperationStatus,
  ReceiptOperation,
  successfulReceiptOperation,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { HoldOperation, Transaction } from './model';

export class CommonServiceImpl implements CommonService, HealthService {

  storage: Storage;

  constructor(accountService: Storage) {
    this.storage = accountService;
  }

  liveness(): Promise<void> {
    return Promise.resolve();
  }

  readiness(): Promise<void> {
    return Promise.resolve();
  }

  transactions: Record<string, Transaction> = {};

  public registerTransaction(tx: Transaction) {
    this.transactions[tx.id] = tx;
  }

  public async getReceipt(id: string): Promise<ReceiptOperation> {
    const tx = this.transactions[id];
    if (tx === undefined) {
      throw new ValidationError('transaction not found!');
    }
    return successfulReceiptOperation(tx.toReceipt());
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    const tx = this.transactions[cid];
    if (tx === undefined) {
      throw new ValidationError('transaction not found!');
    }
    return successfulReceiptOperation(tx.toReceipt());
  }
}


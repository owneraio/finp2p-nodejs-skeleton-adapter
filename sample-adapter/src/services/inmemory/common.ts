import { Storage } from './storage';
import {
  BusinessError, CommonService, HealthService, ValidationError,
  OperationStatus,
  ReceiptOperation,
  successfulReceiptOperation,
} from '@owneraio/finp2p-adapter-models';
import { Transaction } from './model';

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

  public async getReceipt(id: string): Promise<ReceiptOperation> {
    const tx = this.storage.getTransaction(id);
    if (tx === undefined) {
      throw new ValidationError('transaction not found!');
    }
    return successfulReceiptOperation(tx.toReceipt());
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    const tx = this.storage.getTransaction(cid);
    if (tx === undefined) {
      throw new ValidationError('transaction not found!');
    }
    return successfulReceiptOperation(tx.toReceipt());
  }
}


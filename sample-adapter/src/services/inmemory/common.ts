import {
  CommonService, HealthService,
  OperationStatus,
  ReceiptOperation,
  ValidationError,
  successfulReceiptOperation
} from '@owneraio/finp2p-adapter-models';
import { Storage } from './storage';

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
    const tx = this.storage.transactions[id];
    if (tx === undefined) {
      throw new ValidationError('transaction not found!');
    }
    return successfulReceiptOperation(tx.toReceipt());
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    const tx = this.storage.transactions[cid];
    if (tx === undefined) {
      throw new ValidationError('transaction not found!');
    }
    return successfulReceiptOperation(tx.toReceipt());
  }
}


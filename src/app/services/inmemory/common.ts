import { AccountService } from './accounts';
import {BusinessError, CommonService, HealthService, ValidationError} from '../../../lib/services';
import {
  OperationStatus,
  ReceiptOperation,
  successfulReceiptOperation,
} from '../../../lib/services';
import {HoldOperation, Transaction} from './model';

export class CommonServiceImpl implements CommonService, HealthService {

  accountService: AccountService;

  constructor(accountService: AccountService) {
    this.accountService = accountService;
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


import { logger } from '../helpers/logger';
import { AccountService } from './accounts';
import Asset = Components.Schemas.Asset;
import Source = Components.Schemas.Source;
import Destination = Components.Schemas.Destination;
import Receipt = Components.Schemas.Receipt;
import OperationStatus = Components.Schemas.OperationStatus;
import ReceiptOperation = Components.Schemas.ReceiptOperation;
import Balance = Components.Schemas.Balance;

export class Transaction {

  constructor(id: string, amount: number, asset: Asset, timestamp: number, source?: Source, destination?: Destination) {
    this.id = id;
    this.source = source;
    this.destination = destination;
    this.amount = amount;
    this.asset = asset;
    this.timestamp = timestamp;
  }

  id: string;

  source?: Source;

  destination?: Destination;

  amount: number;

  asset: Asset;

  timestamp: number;

  public static toReceipt(tx: Transaction): Receipt {
    return {
      id: tx.id,
      asset: tx.asset,
      quantity: `${tx.amount}`,
      source: tx.source,
      destination: tx.destination,
      timestamp: tx.timestamp,
    };
  }
}

export class CommonService {

  accountService: AccountService = AccountService.GetService();

  transactions: Record<string, Transaction> = {};

  public async balance(request: Paths.GetAssetBalance.RequestBody): Promise<Paths.GetAssetBalance.Responses.$200> {
    logger.debug('balance', { request });
    const id = AccountService.extractId(request.owner);
    const balance = this.accountService.getBalance(id, request.asset);
    return {
      asset: request.asset,
      balance: `${balance}`,
    } as Balance;
  }

  public async getReceipt(id: Paths.GetReceipt.Parameters.TransactionId): Promise<Paths.GetReceipt.Responses.$200> {
    const tx = this.transactions[id];
    if (tx === undefined) {
      throw new Error('transaction not found!');
    }
    return {
      isCompleted: true,
      response: Transaction.toReceipt(tx),
    } as ReceiptOperation;
  }

  public async operationStatus(cid: string): Promise<Paths.GetOperation.Responses.$200> {
    const tx = this.transactions[cid];
    if (tx === undefined) {
      throw new Error('transaction not found!');
    }
    return {
      type: 'receipt', operation: {
        isCompleted: true,
        response: Transaction.toReceipt(tx),
      } as ReceiptOperation,
    } as OperationStatus;
  }
}


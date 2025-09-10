import { Asset, Destination, ExecutionContext, OperationType, Receipt, Source } from '../../../lib/services';
import { v4 as uuid } from 'uuid';


export class Transaction {

  id: string;

  source?: Source;

  destination?: Destination;

  quantity: string;

  asset: Asset;

  executionContext?: ExecutionContext;

  operationType: OperationType;

  operationId?: string;

  timestamp: number;

  constructor(quantity: string, asset: Asset,
    source: Source | undefined,
    destination: Destination | undefined,
    executionContext: ExecutionContext | undefined,
    operationType: OperationType,
    operationId: string | undefined) {
    this.id = uuid();
    this.source = source;
    this.destination = destination;
    this.quantity = quantity;
    this.asset = asset;
    this.executionContext = executionContext;
    this.operationType = operationType;
    this.operationId = operationId;
    this.timestamp = Date.now();
  }

  public toReceipt(): Receipt {
    const { id, source, destination, quantity, asset, executionContext, operationType, operationId, timestamp } = this;
    return {
      id, asset, quantity, source, destination, operationType, timestamp,
      tradeDetails: {
        executionContext,
      },
      transactionDetails: {
        transactionId: id,
        operationId,
      },
    } as Receipt;
  }
}

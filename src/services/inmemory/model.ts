import { Asset, Destination, ExecutionContext, OperationType, Receipt, Source } from '../model';


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

  constructor(id: string, quantity: string, asset: Asset,
    source: Source | undefined,
    destination: Destination | undefined,
    executionContext: ExecutionContext | undefined,
    operationType: OperationType,
    operationId: string | undefined,
    timestamp: number) {
    this.id = id;
    this.source = source;
    this.destination = destination;
    this.quantity = quantity;
    this.asset = asset;
    this.executionContext = executionContext;
    this.operationType = operationType;
    this.operationId = operationId;
    this.timestamp = timestamp;
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

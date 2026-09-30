import {
  Asset,
  Destination,
  ExecutionContext,
  OperationType,
  Receipt,
  Source,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import {
  generateId,
} from './utils';


export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceError';
    Object.setPrototypeOf(this, ServiceError.prototype);
  }
}

export type HoldOperation = {
  finId: string
  quantity: string
};

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

  /** ledger transaction id; defaults to the receipt id, shared across swap legs */
  transactionId: string;

  constructor(quantity: string, asset: Asset,
    source: Source | undefined,
    destination: Destination | undefined,
    executionContext: ExecutionContext | undefined,
    operationType: OperationType,
    operationId: string | undefined,
    transactionId?: string) {
    this.id = generateId();
    this.transactionId = transactionId ?? this.id;
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
    const { id, source, destination, quantity, asset, executionContext, operationType, operationId, timestamp, transactionId } = this;
    return {
      id, asset, quantity, source, destination, operationType, timestamp,
      tradeDetails: {
        executionContext,
      },
      transactionDetails: {
        transactionId,
        operationId,
      },
    } as Receipt;
  }
}

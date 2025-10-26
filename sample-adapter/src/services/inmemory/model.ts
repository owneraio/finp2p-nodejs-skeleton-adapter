import {
  Asset,
  Destination,
  ExecutionContext,
  FinIdAccount,
  OperationType,
  Receipt,
} from '@owneraio/finp2p-adapter-models';
import { generateId } from './utils';


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

  source?: FinIdAccount;

  destination?: Destination;

  quantity: string;

  asset: Asset;

  executionContext?: ExecutionContext;

  operationType: OperationType;

  operationId?: string;

  timestamp: number;

  constructor(quantity: string, asset: Asset,
    source: FinIdAccount | undefined,
    destination: Destination | undefined,
    executionContext: ExecutionContext | undefined,
    operationType: OperationType,
    operationId: string | undefined) {
    this.id = generateId();
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

import {
  Asset, Destination, ExecutionContext, OperationType, Receipt, Source,
} from '@owneraio/finp2p-adapter-models';
import { LedgerTransaction } from './storage';

export class ReceiptBuilder {
  build(
    tx: LedgerTransaction,
    asset: Asset,
    source: Source | undefined,
    destination: Destination | undefined,
    quantity: string,
    operationType: OperationType,
    exCtx: ExecutionContext | undefined,
    operationId: string | undefined,
    externalTransactionId?: string,
  ): Receipt {
    return {
      id: tx.id,
      asset,
      source,
      destination,
      quantity,
      transactionDetails: {
        transactionId: externalTransactionId ?? tx.id,
        operationId,
      },
      tradeDetails: {
        executionContext: exCtx,
      },
      operationType,
      proof: undefined,
      timestamp: tx.created_at.getTime(),
    };
  }
}

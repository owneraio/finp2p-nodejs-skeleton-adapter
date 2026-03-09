import {
  Asset, Destination, ExecutionContext, OmnibusDelegate,
  OperationType, Receipt, Source,
} from '@owneraio/finp2p-adapter-models';
import { OmnibusTransaction } from './storage';

export class ReceiptBuilder {
  constructor(private delegate: OmnibusDelegate) {}

  async build(
    tx: OmnibusTransaction,
    asset: Asset,
    source: Source | undefined,
    destination: Destination | undefined,
    quantity: string,
    operationType: OperationType,
    exCtx: ExecutionContext | undefined,
    operationId: string | undefined,
  ): Promise<Receipt> {
    if (this.delegate.generateReceipt) {
      return this.delegate.generateReceipt(
        asset, source, destination, quantity,
        operationType, tx.id, exCtx, operationId,
      );
    }

    return {
      id: tx.id,
      asset,
      source,
      destination,
      quantity,
      transactionDetails: {
        transactionId: tx.id,
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

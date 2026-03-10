import {
  Asset, Destination, ExecutionContext, OperationType, Receipt, Source,
} from '@owneraio/finp2p-adapter-models';
import { ExternalTransferDelegate } from './interfaces';
import { LedgerTransaction } from './storage';

export class ReceiptBuilder {
  constructor(private delegate: ExternalTransferDelegate) {}

  async build(
    tx: LedgerTransaction,
    asset: Asset,
    source: Source | undefined,
    destination: Destination | undefined,
    quantity: string,
    operationType: OperationType,
    exCtx: ExecutionContext | undefined,
    operationId: string | undefined,
    externalTransactionId?: string,
  ): Promise<Receipt> {
    if (this.delegate.generateReceipt) {
      return this.delegate.generateReceipt(
        asset, source, destination, quantity,
        operationType, externalTransactionId ?? tx.id, exCtx, operationId,
      );
    }

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

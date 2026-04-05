import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import {
  Asset, Destination, ExecutionContext, OperationType, Receipt, Source,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { LedgerTransaction } from './storage';

export const generateCid = (): string => bs58.encode(Uint8Array.from(randomBytes(64)));

export function buildReceipt(
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

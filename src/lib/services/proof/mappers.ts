import { Receipt } from '../model';
import {
  eip712Asset,
  eip712ExecutionContext,
  EIP712ReceiptMessage,
  eip712TradeDetails,
  eip712TransactionDetails,
} from '../eip712';


export const receiptToEIP712Message = (receipt: Receipt): EIP712ReceiptMessage => {
  const {
    id,
    operationType,
    asset: { assetId, assetType },
    quantity,
    source,
    destination,
    transactionDetails: { operationId, transactionId },
    tradeDetails: { executionContext: exCtx },
  } = receipt;
  return {
    id,
    operationType,
    source: { accountType: source ? 'finId' : '', finId: source?.finId || '' },
    destination: { accountType: destination ? 'finId' : '', finId: destination?.finId || '' },
    quantity,
    asset: eip712Asset(assetId, assetType),
    tradeDetails: eip712TradeDetails(eip712ExecutionContext(
      exCtx?.planId || '', `${exCtx?.sequence || ''}`)),
    transactionDetails: eip712TransactionDetails(operationId || '', id),
  };
};

import * as axios from 'axios';
import { request } from './requestUtils';
import { v4 as uuidv4 } from 'uuid';
import { FinP2PHost } from './config';



export type TxAsset = {
  type: 'finp2p';
  resourceId: string;
} | {
  type: 'cryptocurrency' | 'fiat';
  code: string;
};

export interface Transaction {
  id: string;
  asset: TxAsset;
  quantity: string;
  source?: {
    finId: string;
    account: { type: 'finId'; finId: string; orgId: string };
  };
  destination: {
    finId: string;
    account: { type: 'finId'; finId: string; orgId: string };
  };
  transactionDetails: {
    transactionId: string
    inputs: [{ index: number, quantity: string, transactionId: string }]
    outputs: [{ index: number, publicKey: string, quantity: string }]
  }
  timestamp: number;
}

export const importTransactions = async (transactions: Transaction[], host = '') => {
  return request({
    host,
    type: 'post',
    url: '/finapi/ledger/transaction/import',
    data: {
      transactions,
    },
  });
};

export const issueAssets = async (assetId: string, amount: number, issuerFinId: string, host: string  = FinP2PHost) => {
  const txId = uuidv4();
  return importTransactions([{
    id: txId,
    asset: {
      type: 'finp2p',
      resourceId: assetId,
    },
    quantity: `${amount}`,
    destination: {
      finId: issuerFinId,
      account: {
        type: 'finId',
        finId: issuerFinId,
      },
    },
    transactionDetails: {
      transactionId: txId,
    },
    timestamp: Date.now(),
  }] as Transaction[], host);
};
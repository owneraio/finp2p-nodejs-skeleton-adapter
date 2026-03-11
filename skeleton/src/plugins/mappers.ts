import {
  Asset,
  AssetCreationStatus,
  Destination,
  DepositOperation,
  OperationStatus,
  PlanApprovalStatus,
  Receipt,
  ReceiptOperation,
  Source,
} from '@owneraio/finp2p-adapter-models';
import { OpComponents } from '@owneraio/finp2p-client';
import { contractDetailsOptToAPI, depositInstructionToAPI, tradeDetailsToAPI, transactionDetailsToAPI, proofPolicyOptToAPI } from '../routes';

const receiptToFinAPI = (receipt: Receipt): OpComponents['schemas']['receipt'] => {
  const { id, asset, source, destination, quantity, operationType, tradeDetails, transactionDetails, proof, timestamp } = receipt;
  const apiAsset: OpComponents['schemas']['asset'] = { resourceId: asset.assetId };
  return {
    id,
    quantity,
    timestamp,
    source: source ? { finId: source.finId, asset: apiAsset } : undefined,
    destination: destination ? { finId: destination.finId, asset: apiAsset } : undefined,
    operationType: operationType as OpComponents['schemas']['operationType'],
    tradeDetails: tradeDetailsToAPI(tradeDetails),
    transactionDetails: transactionDetails ? transactionDetailsToAPI(transactionDetails) : undefined,
    proof: proofPolicyOptToAPI(proof) as OpComponents['schemas']['schemas-proofPolicy'] | undefined,
  };
};


export const createAssetOperationToFinAPI = (operationStatus: AssetCreationStatus): OpComponents['schemas']['operationStatusCreateAsset'] => {
  switch (operationStatus.type) {
    case 'success':
      const { result: { ledgerIdentifier, reference } } = operationStatus;
      let ledgerReference: OpComponents['schemas']['contractDetails'] | undefined;
      if (reference) {
        const { address, tokenStandard: TokenStandard, additionalContractDetails } = reference;
        ledgerReference = {
          type: 'contractDetails',
          address, TokenStandard,
          additionalContractDetails: contractDetailsOptToAPI(additionalContractDetails) as OpComponents['schemas']['finP2PEVMOperatorDetails'] | undefined,
        };
      }
      return {
        type: 'createAsset',
        operation: {
          cid: '',
          isCompleted: true,
          response: {
            ledgerAssetInfo: {
              ledgerIdentifier: {
                assetIdentifierType: 'CAIP-19',
                network: ledgerIdentifier.network,
                tokenId: ledgerIdentifier.tokenId,
                standard: ledgerIdentifier.standard,
              },
              ledgerReference,
            },
          },
        },
      };
    case 'failure':
      const { error: { code, message } } = operationStatus;
      return {
        type: 'createAsset',
        operation: {
          cid: '',
          isCompleted: true,
          error: { code, message },
        },
      };
    case 'pending':
      const { correlationId: cid } = operationStatus;
      return { type: 'createAsset', operation: { cid, isCompleted: false } };
  }
};

export const depositOperationToFinAPI = (operationStatus: DepositOperation): OpComponents['schemas']['operationStatusDeposit'] => {
  switch (operationStatus.type) {
    case 'success':
      const { instruction } = operationStatus;
      return {
        type: 'deposit',
        operation: {
          cid: '',
          isCompleted: true,
          response: depositInstructionToAPI(instruction),
        },
      };
    case 'failure':
      const { error: { code, message } } = operationStatus;
      return {
        type: 'deposit',
        operation: {
          cid: '',
          isCompleted: true,
          error: {},
        },
      };
    case 'pending':
      const { correlationId: cid } = operationStatus;
      return { type: 'deposit', operation: { cid, isCompleted: false } };
  }
};

export const planApprovalOperationToFinAPI = (operationStatus: PlanApprovalStatus): OpComponents['schemas']['operationStatusApproval'] => {
  switch (operationStatus.type) {
    case 'approved':
      return {
        type: 'approval',
        operation: {
          cid: '',
          isCompleted: true,
          approval: {
            status: 'approved',
          },
        },
      };
    case 'rejected':
      const { error: { code, message } } = operationStatus;
      return {
        type: 'approval',
        operation: {
          cid: '',
          isCompleted: true,
          approval: {
            status: 'rejected',
            failure: {
              failureType: 'validationFailure',
              code, message,
            },
          },
        },
      };
    case 'pending':
      const { correlationId: cid } = operationStatus;
      return { type: 'approval', operation: { cid, isCompleted: false } };
  }
};

export const receiptOperationToFinAPI = (operationStatus: ReceiptOperation): OpComponents['schemas']['operationStatusReceipt'] => {
  switch (operationStatus.type) {
    case 'success':
      const { receipt } = operationStatus;
      return {
        type: 'receipt',
        operation: {
          cid: '',
          isCompleted: true,
          response: receiptToFinAPI(receipt),
        },
      };
    case 'failure':
      const { error: { code, message } } = operationStatus;
      return {
        type: 'receipt',
        operation: {
          cid: '',
          isCompleted: true,
          error: { code, message },
        },
      };
    case 'pending':
      const { correlationId: cid } = operationStatus;
      return { type: 'receipt', operation: { cid, isCompleted: false } };
  }
};

export const operationToFinAPI = (operationStatus: OperationStatus): OpComponents['schemas']['operationStatus'] => {
  switch (operationStatus.operation) {
    case 'createAsset':
      return createAssetOperationToFinAPI(operationStatus);
    case 'deposit':
      return depositOperationToFinAPI(operationStatus);
    case 'approval':
      return planApprovalOperationToFinAPI(operationStatus);
    case 'receipt':
      return receiptOperationToFinAPI(operationStatus);
  }
};

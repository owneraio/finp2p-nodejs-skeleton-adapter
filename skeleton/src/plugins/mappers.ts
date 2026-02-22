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
import { depositInstructionToAPI, tradeDetailsToAPI, transactionDetailsToAPI, proofPolicyOptToAPI } from '../routes';

const assetToFinAPI = (asset: Asset): OpComponents['schemas']['schemas-asset'] => {
  switch (asset.assetType) {
    case 'fiat':
      return { type: 'fiat', code: asset.assetId };
    case 'cryptocurrency':
      return { type: 'cryptocurrency', code: asset.assetId };
    case 'finp2p':
      return { type: 'finp2p', resourceId: asset.assetId };
  }
};

const sourceToFinAPI = (source: Source): OpComponents['schemas']['source'] => {
  const { finId } = source;
  return { finId, account: { type: 'finId', finId } };
};

const destinationToFinAPI = (destination: Destination): OpComponents['schemas']['destination'] => {
  const { finId } = destination;
  return { finId, account: { type: 'finId', finId } };
};

const receiptToFinAPI = (receipt: Receipt): OpComponents['schemas']['receipt'] => {
  const { id, asset, source, destination, quantity, operationType, tradeDetails, transactionDetails, proof, timestamp } = receipt;
  return {
    id,
    asset: assetToFinAPI(asset),
    quantity,
    timestamp,
    source: source ? sourceToFinAPI(source) : undefined,
    destination: destination ? destinationToFinAPI(destination) : undefined,
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
        const { network, address, tokenStandard: TokenStandard, additionalContractDetails } = reference;
        ledgerReference = {
          type: 'contractDetails',
          network, address, TokenStandard, additionalContractDetails,
        };
      }
      return {
        type: 'createAsset',
        operation: {
          cid: '',
          isCompleted: true,
          response: {
            ledgerAssetInfo: {
              ledgerTokenId: {
                type: 'tokenId',
                tokenId: ledgerIdentifier.tokenId,
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

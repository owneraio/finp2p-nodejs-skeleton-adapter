import {
  AssetCreationStatus,
  DepositOperation,
  OperationStatus,
  PlanApprovalStatus,
  ReceiptOperation,
} from '../services';
import { OpComponents } from '@owneraio/finp2p-client';
import { depositInstructionToAPI, receiptToAPI } from '../routes';


export const createAssetOperationToFinAPI = (operationStatus: AssetCreationStatus): OpComponents['schemas']['operationStatusCreateAsset'] => {
  switch (operationStatus.type) {
    case 'success':
      const { result: { tokenId, reference } } = operationStatus;
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
                tokenId,
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
          response: receiptToAPI(receipt),
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

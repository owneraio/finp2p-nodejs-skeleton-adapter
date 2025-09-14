import {
  Asset,
  Source,
  Destination,
  Signature,
  ExecutionContext,
  AssetCreationStatus,
  ReceiptOperation,
  Balance, Receipt, OperationStatus, EIP712Template, EIP712Domain, EIP712Message, EIP712Types, TradeDetails,
  TransactionDetails, ProofPolicy, PlanApprovalStatus, DepositOperation, DepositInstruction, DepositAsset,
  HashListTemplate, SignatureTemplate, PaymentMethod, PaymentMethodInstruction, WireDetails,
} from '../services';
import { components } from './model-gen';

export const assetFromAPI = (asset: components['schemas']['asset']): Asset => {
  switch (asset.type) {
    case 'fiat':
      return {
        assetId: asset.code, assetType: 'fiat',
      };
    case 'finp2p':
      return {
        assetId: asset.resourceId, assetType: 'finp2p',
      };
    case 'cryptocurrency':
      return {
        assetId: asset.code, assetType: 'cryptocurrency',
      };
  }
};

export const depositAssetFromAPI = (asset: components['schemas']['depositAsset']): DepositAsset => {
  switch (asset.type) {
    case 'custom':
      return {
        assetType: 'custom',
      };
    default:
      return assetFromAPI(asset);
  }
};

export const assetToAPI = (asset: Asset): components['schemas']['asset'] => {
  switch (asset.assetType) {
    case 'fiat':
      return { type: 'fiat', code: asset.assetId };
    case 'cryptocurrency':
      return { type: 'cryptocurrency', code: asset.assetId };
    case 'finp2p':
      return { type: 'finp2p', resourceId: asset.assetId };
  }
};

export const sourceFromAPI = (source: components['schemas']['source']): Source => {
  const { finId } = source;
  return { finId };
};

export const sourceOptToAPI = (source: Source | undefined): components['schemas']['source'] | undefined => {
  if (!source) {
    return undefined;
  }
  const { finId } = source;
  return { finId, account: { type: 'finId', finId } };
};

export const destinationFromAPI = (destination: components['schemas']['destination']): Destination => {
  const { finId } = destination;
  return { finId };
};

export const destinationOptFromAPI = (destination: components['schemas']['destination'] | undefined): Destination | undefined => {
  if (!destination) {
    return undefined;
  }
  return destinationFromAPI(destination);
};

export const destinationToAPI = (destination: Destination): components['schemas']['destination'] => {
  const { finId } = destination;
  return { finId, account: { type: 'finId', finId } };
};

export const destinationOptToAPI = (destination: Destination | undefined): components['schemas']['destination'] | undefined => {
  if (!destination) {
    return undefined;
  }
  return destinationToAPI(destination);
};

export const executionContextFromAPI = (ep: components['schemas']['executionContext']): ExecutionContext => {
  const { executionPlanId, instructionSequenceNumber } = ep;
  return { planId: executionPlanId, sequence: instructionSequenceNumber };
};

export const executionContextOptFromAPI = (ep: components['schemas']['executionContext'] | undefined): ExecutionContext | undefined => {
  if (!ep) {
    return undefined;
  }
  return executionContextFromAPI(ep);
};


export const hashListTemplateFromAPI = (template: components['schemas']['hashListTemplate']): HashListTemplate => {
  const { hash, hashGroups } = template;
  return {
    type: 'hashList',
    hash, hashGroups,
  } as HashListTemplate;
};

export const eip712TemplateFromAPI = (template: components['schemas']['EIP712Template']): EIP712Template => {
  const { domain, primaryType, message, types } = template;
  return {
    type: 'EIP712',
    primaryType,
    domain: domain as EIP712Domain,
    message: message as EIP712Message,
    types: types as EIP712Types,
  } as EIP712Template;
};

export const signatureFromAPI = (sg: components['schemas']['signature']): Signature => {
  const { template, signature } = sg;
  switch (template.type) {
    case 'hashList':
      return {
        signature,
        template: hashListTemplateFromAPI(template),
      } as Signature;

    case 'EIP712':
      return {
        signature,
        template: eip712TemplateFromAPI(template),
      } as Signature;
    default:
      throw new Error('hashList signature template not supported');
  }
};

export const signatureOptFromAPI = (sg: components['schemas']['signature'] | undefined): Signature | undefined => {
  if (!sg) {
    return undefined;
  }
  return signatureFromAPI(sg);
};


export const planApprovalOperationToAPI = (status: PlanApprovalStatus): components['schemas']['ExecutionPlanApprovalOperation'] => {
  switch (status.type) {
    case 'approved':
      return {
        isCompleted: true,
        cid: '',
        approval: {
          status: 'approved',
        },
      };

    case 'rejected':
      const { code, message } = status.error;
      return {
        isCompleted: true,
        cid: '',
        approval: {
          status: 'rejected',
          failure: {
            failureType: 'validationFailure',
            code, message,
          },
        },
      };

    case 'pending':
      const { correlationId } = status;
      return {
        isCompleted: false,
        cid: correlationId,
      };
  }

};

export const createAssetOperationToAPI = (result: AssetCreationStatus): components['schemas']['CreateAssetResponse'] => {
  switch (result.type) {
    case 'success':
      const { tokenId, tokenAddress, finp2pTokenAddress } = result;
      return {
        isCompleted: true,
        cid: '',
        response: {
          ledgerAssetInfo: {
            ledgerTokenId: {
              type: 'tokenId', tokenId: tokenId,
            },
            ledgerReference: {
              type: 'contractDetails',
              network: 'ethereum',
              address: tokenAddress,
              TokenStandard: 'TokenStandard_ERC20',
              additionalContractDetails: {
                FinP2POperatorContractAddress: finp2pTokenAddress, allowanceRequired: true,
              },
            },
          },
        },
      };

    case 'failure':
      const { code, message } = result.error;
      return {
        isCompleted: true,
        cid: '',
        error: { code, message },
      };

    case 'pending':
      const { correlationId: cid } = result;
      return {
        isCompleted: false, cid,
      };

    default:
      throw new Error('Unsupported asset creation status');
  }
};


export const executionContextOptToAPI = (ep: ExecutionContext | undefined): components['schemas']['executionContext'] | undefined => {
  if (!ep) {
    return undefined;
  }
  const { planId, sequence } = ep;
  return { executionPlanId: planId, instructionSequenceNumber: sequence };
};

export const tradeDetailsToAPI = (tradeDetails: TradeDetails): components['schemas']['receiptTradeDetails'] => {
  const { executionContext } = tradeDetails;
  return {
    executionContext: executionContextOptToAPI(executionContext),
  };
};

export const transactionDetailsToAPI = (details: TransactionDetails): components['schemas']['transactionDetails'] => {
  const { transactionId, operationId } = details;
  return {
    transactionId,
    operationId,
  };
};

export const hashListTemplateToAPI = (template: HashListTemplate): components['schemas']['hashListTemplate'] => {
  const { hash, hashGroups } = template;
  return {
    type: 'hashList',
    hash, hashGroups,
  };
};

export const eip712TemplateToAPI = (template: EIP712Template): components['schemas']['EIP712Template'] => {
  const { domain, primaryType, message, types, hash } = template;
  return {
    type: 'EIP712',
    domain: domain,
    primaryType,
    message: message as {
      [key: string]: components['schemas']['EIP712TypedValue'];
    },
    hash,
    types: types,
  };
};

export const signatureTemplateToAPI = (template: SignatureTemplate): components['schemas']['signatureTemplate'] => {
  switch (template.type) {
    case 'hashList':
      return hashListTemplateToAPI(template);
    case 'EIP712':
      return eip712TemplateToAPI(template);
  }
};

export const proofPolicyToAPI = (proof: ProofPolicy): components['schemas']['proofPolicy'] => {
  switch (proof.type) {
    case 'no-proof':
      return {
        type: 'noProofPolicy',
      };
    case 'signature-proof':
      const { signature, hashFunc, template } = proof;
      return {
        type: 'signatureProofPolicy',
        signature: {
          template: signatureTemplateToAPI(template),
          hashFunc, signature,
        },
      };
  }
};

export const proofPolicyOptToAPI = (proof: ProofPolicy | undefined): components['schemas']['proofPolicy'] | undefined => {
  if (!proof) {
    return undefined;
  }
  return proofPolicyToAPI(proof);
};

export const receiptToAPI = (receipt: Receipt): components['schemas']['receipt'] => {
  const {
    id,
    asset,
    source,
    destination,
    quantity,
    operationType,
    tradeDetails,
    transactionDetails,
    proof,
    timestamp,
  } = receipt;
  return {
    id,
    asset: assetToAPI(asset),
    source: sourceOptToAPI(source),
    destination: destinationOptToAPI(destination),
    quantity,
    operationType: operationType as components['schemas']['operationType'],
    tradeDetails: tradeDetailsToAPI(tradeDetails),
    transactionDetails: transactionDetailsToAPI(transactionDetails),
    proof: proofPolicyOptToAPI(proof),
    timestamp,
  };
};

export const receiptOperationToAPI = (op: ReceiptOperation): components['schemas']['receiptOperation'] => {
  switch (op.type) {
    case 'pending':
      const { correlationId: cid } = op;
      return {
        isCompleted: false, cid,
      };
    case 'failure':
      const { code, message } = op.error;
      return {
        isCompleted: true,
        cid: '',
        error: { code, message },
      };
    case 'success':
      const { receipt } = op;
      return {
        isCompleted: true,
        cid: '',
        response: receiptToAPI(receipt),
      };
  }
};

export const wireDetailsToAPI = (details: WireDetails):
components['schemas']['ibanAccountDetails'] | components['schemas']['swiftAccountDetails'] | components['schemas']['sortCodeDetails'] => {
  switch (details.type) {
    case 'iban': {
      const { iban } = details;
      return { type: 'iban', iban };
    }
    case 'swift': {
      const { swiftCode, accountNumber } = details;
      return { type: 'swift', swiftCode, accountNumber };
    }
    case 'sortCode': {
      const { code, accountNumber } = details;
      return { type: 'sortCode', code, accountNumber };
    }
  }
};

export const paymentMethodInstructionToAPI = (method: PaymentMethodInstruction):
components['schemas']['wireTransfer'] | components['schemas']['wireTransferUSA'] | components['schemas']['cryptoTransfer'] | components['schemas']['paymentInstructions'] => {
  switch (method.type) {
    case 'wireTransfer': {
      const { accountHolderName, bankName, wireDetails, line1, city, postalCode, country } = method;
      return {
        type: 'wireTransfer',
        accountHolderName,
        bankName,
        wireDetails: wireDetailsToAPI(wireDetails),
        line1,
        city,
        postalCode,
        country,
      };
    }
    case 'wireTransferUSA': {
      const { accountNumber, routingNumber, line1, city, postalCode, country, state } = method;
      return {
        type: 'wireTransferUSA',
        accountNumber,
        routingNumber,
        line1,
        city,
        postalCode,
        country,
        state,
      };
    }
    case 'cryptoTransfer': {
      const { network, contractAddress, walletAddress } = method;
      return {
        type: 'cryptoTransfer',
        network,
        contractAddress,
        walletAddress,
      };
    }
    case 'paymentInstructions':
      const { instruction } = method;
      return {
        type: 'paymentInstructions',
        instruction,
      };
  }
};

export const paymentMethodToAPI = (method: PaymentMethod): components['schemas']['paymentMethod'] => {
  const { description, currency, methodInstruction } = method;
  return {
    description,
    currency,
    methodInstruction: paymentMethodInstructionToAPI(methodInstruction),
  };
};

export const depositInstructionToAPI = (instruction: DepositInstruction): components['schemas']['depositInstruction'] => {
  const { account, description, operationId, details, paymentOptions } = instruction;
  return {
    account: destinationToAPI(account),
    description,
    paymentOptions: paymentOptions ? paymentOptions.map(paymentMethodToAPI) : [],
    operationId,
    details,
  };
};

export const depositOperationToAPI = (op: DepositOperation): components['schemas']['depositOperation'] => {
  switch (op.type) {
    case 'pending':
      const { correlationId: cid } = op;
      return { isCompleted: false, cid };
    case 'failure':
      // const { code, message } = op.error;
      return {
        isCompleted: true,
        cid: '',
        error: {},
      };
    case 'success':
      const { instruction } = op;
      return {
        isCompleted: true,
        cid: '',
        response: depositInstructionToAPI(instruction),
      };
  }
};

export const operationStatusToAPI = (op: OperationStatus): components['schemas']['operationStatus'] => {
  switch (op.operation) {
    case 'createAsset':
      return {
        type: 'createAsset',
        operation: createAssetOperationToAPI(op),
      };
    case 'deposit':
      return {
        type: 'deposit',
        operation: depositOperationToAPI(op),
      };
    case 'receipt':
      return {
        type: 'receipt',
        operation: receiptOperationToAPI(op),
      };

    case 'approval':
      return {
        type: 'approval',
        operation: planApprovalOperationToAPI(op),
      };
  }
};


export const balanceToAPI = (
  asset: components['schemas']['asset'],
  account: components['schemas']['assetBalanceAccount'],
  balance: Balance,
): components['schemas']['AssetBalanceInfoResponse'] => {
  const { current, available, held } = balance;
  return {
    account, asset,
    balanceInfo: {
      asset,
      current,
      available,
      held,
    },
  };
};

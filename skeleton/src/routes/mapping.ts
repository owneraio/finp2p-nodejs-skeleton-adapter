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
  FinIdAccount, AssetBind, AssetDenomination, LedgerReference, AdditionalContractDetails,
  AssetCreationResult, OperationMetadata, ValidationError,
} from '@owneraio/finp2p-adapter-models';
import { components } from './model-gen';
import { LedgerAPI } from './index';

export const assetFromAPI = (asset: components['schemas']['asset'] | components['schemas']['finp2pAsset']): Asset => {
  return { assetId: asset.resourceId, assetType: 'finp2p' };
};

export const depositAssetFromAPI = (asset: components['schemas']['depositAsset']): DepositAsset => {
  if (asset.type === 'custom') {
    return { assetType: 'custom' };
  }
  return { assetId: asset.resourceId, assetType: 'finp2p' };
};

export const assetToAPI = (asset: Asset): components['schemas']['asset'] => {
  return { resourceId: asset.assetId };
};

type AccountLike = components['schemas']['account'] | components['schemas']['depositPayoutAccount'];

export const sourceFromAPI = (source: AccountLike): Source => {
  const { finId } = source;
  return { finId, account: { type: 'finId', finId } };
};

export const destinationFromAPI = (destination: AccountLike): Destination => {
  const { finId } = destination;
  return { finId, account: { type: 'finId', finId } };
};

export const destinationOptFromAPI = (destination: AccountLike | undefined): Destination | undefined => {
  if (!destination) {
    return undefined;
  }
  return destinationFromAPI(destination);
};

export const depositPayoutAccountToAPI = (dest: Destination): components['schemas']['depositPayoutAccount'] => {
  const { finId } = dest;
  return { finId, account: { type: 'finId', finId } };
};

export const finIdAccountFromAPI = (account: components['schemas']['finIdAccount']): FinIdAccount => {
  const { finId } = account;
  return { type: 'finId', finId };
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

export const assetBindingFromAPI = (assetBind: components['schemas']['ledgerAssetBinding']): AssetBind => {
  const { tokenId, network, standard } = assetBind;
  return {
    tokenIdentifier: { tokenId, network, standard },
  };
};

export const assetBindingOptFromAPI = (assetBind: components['schemas']['ledgerAssetBinding'] | undefined): AssetBind | undefined => {
  if (!assetBind) {
    return undefined;
  }
  return assetBindingFromAPI(assetBind);
};

export const assetDenominationFromAPI = (denom: components['schemas']['assetDenomination']): AssetDenomination => {
  const { type, code } = denom;
  return { type, code };
};

export const assetDenominationOptFromAPI = (denom: components['schemas']['assetDenomination'] | undefined): AssetDenomination | undefined => {
  if (!denom) {
    return undefined;
  }
  return assetDenominationFromAPI(denom);
};


export const hashListTemplateFromAPI = (template: components['schemas']['hashListTemplate']): HashListTemplate => {
  const { hash, hashGroups } = template;
  return {
    type: 'hashList',
    hash, hashGroups,
  } as HashListTemplate;
};

const eip712TypesFromAPI = (types: components['schemas']['EIP712Types']): EIP712Types => {
  if (!types.definitions) {
    throw new ValidationError('EIP712 types definitions are missing');
  }
  return types.definitions
    .filter(d => d.name && d.name !== 'EIP712Domain')
    .reduce((d, { name, fields }) => {
      d[name!] = (fields ?? []) as Array<{ name: string; type: string }>;
      return d;
    }, {} as EIP712Types);
};

export const eip712TemplateFromAPI = (template: components['schemas']['EIP712Template']): EIP712Template => {
  const { domain, primaryType, message, types, hash } = template;
  return {
    type: 'EIP712',
    primaryType,
    domain: domain as EIP712Domain,
    message: message as EIP712Message,
    types: eip712TypesFromAPI(types),
    hash,
  } as EIP712Template;
};

export const signatureFromAPI = (sg: components['schemas']['signature']): Signature => {
  const { template, signature, hashFunc } = sg;
  switch (template.type) {
    case 'hashList':
      return {
        signature,
        hashFunc,
        template: hashListTemplateFromAPI(template),
      };

    case 'EIP712':
      return {
        signature,
        hashFunc,
        template: eip712TemplateFromAPI(template),
      };
  }
};

export const signatureOptFromAPI = (sg: components['schemas']['signature'] | undefined): Signature | undefined => {
  if (!sg) {
    return undefined;
  }
  return signatureFromAPI(sg);
};


export const metadataToAPI = (metadata: OperationMetadata): components['schemas']['OperationMetadata'] => {
  const { responseStrategy } = metadata;
  switch (responseStrategy) {
    case 'polling':
      return {
        operationResponseStrategy: {
          type: 'random',
          polling: {
            type: 'randomPollingInterval',
          },
        },
      };
    case 'callback':
      return {
        operationResponseStrategy: {
          type: 'callback',
          callback: {
            type: 'endpoint',
          },
        },
      };
  }

};

export const metadataOptToAPI = (metadata: OperationMetadata | undefined): components['schemas']['OperationMetadata'] | undefined => {
  if (!metadata) {
    return undefined;
  }
  return metadataToAPI(metadata);
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
      const { correlationId, metadata } = status;
      return {
        isCompleted: false,
        cid: correlationId,
        operationMetadata: metadataOptToAPI(metadata),
      };
  }

};

export const contractDetailsToAPI = (details: AdditionalContractDetails): components['schemas']['finP2PEVMOperatorDetails'] => {
  const { finP2POperatorContractAddress, allowanceRequired } = details;
  return {
    FinP2POperatorContractAddress: finP2POperatorContractAddress,
    allowanceRequired,
  };
};

export const contractDetailsOptToAPI = (details: AdditionalContractDetails | undefined): components['schemas']['finP2PEVMOperatorDetails'] | undefined => {
  if (!details) {
    return undefined;
  }
  return contractDetailsToAPI(details);
};

export const ledgerReferenceToAPI = (reference: LedgerReference): components['schemas']['contractDetails'] => {
  const { address, tokenStandard, additionalContractDetails: details } = reference;
  return {
    type: 'contractDetails',
    address,
    TokenStandard: tokenStandard,
    additionalContractDetails: contractDetailsOptToAPI(details),
  };
};

export const ledgerReferenceOptToAPI = (reference: LedgerReference | undefined): components['schemas']['contractDetails'] | undefined => {
  if (!reference) {
    return undefined;
  }
  return ledgerReferenceToAPI(reference);
};

export const assetCreateResultToAPI = (result: AssetCreationResult): components['schemas']['assetCreateResponse'] => {
  const { ledgerIdentifier, reference } = result;
  return {
    ledgerAssetInfo: {
      ledgerIdentifier: {
        assetIdentifierType: 'CAIP-19',
        network: ledgerIdentifier.network,
        tokenId: ledgerIdentifier.tokenId,
        standard: ledgerIdentifier.standard,
        resourceId: ledgerIdentifier.resourceId,
      },
      ledgerReference: ledgerReferenceOptToAPI(reference),
    },
  };
};

export const createAssetOperationToAPI = (status: AssetCreationStatus): components['schemas']['CreateAssetResponse'] => {
  switch (status.type) {
    case 'success':
      const { result } = status;
      return {
        isCompleted: true,
        cid: '',
        response: assetCreateResultToAPI(result),
      };
    case 'failure':
      const { code, message } = status.error;
      return {
        isCompleted: true,
        cid: '',
        error: { code, message },
      };
    case 'pending':
      const { correlationId: cid, metadata } = status;
      return {
        isCompleted: false, cid,
        operationMetadata: metadataOptToAPI(metadata),
      };
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


const isPrimitive = (value: any): boolean => {
  return value !== Object(value);
};

export const eip712MessageToAPI = (message: EIP712Message): {
  [name: string]: LedgerAPI['schemas']['EIP712TypedValue'];
} => {
  const result: Record<string, LedgerAPI['schemas']['EIP712TypedValue']> = {};
  Object.entries(message).forEach(([name, value]) => {
    if (isPrimitive(value)) {
      result[name] = value;
    } else if (typeof value === 'object' && value !== null) {
      result[name] = { ...value } as LedgerAPI['schemas']['EIP712TypeObject'];
    }
  });
  return result;
};

export const eip712TypesToAPI = (types: EIP712Types): LedgerAPI['schemas']['EIP712Types'] => {
  return {
    definitions: Object.entries(types)
      .map(([name, fields]) => {
        return { name, fields };
      }),
  };
};

export const eip712TemplateToAPI = (template: EIP712Template): components['schemas']['EIP712Template'] => {
  const { domain, primaryType, message, types, hash } = template;
  return {
    type: 'EIP712',
    domain: domain,
    primaryType,
    message: eip712MessageToAPI(message),
    hash,
    types: eip712TypesToAPI(types),
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
  const apiAsset = assetToAPI(asset);
  return {
    id,
    quantity,
    timestamp,
    source: source ? { finId: source.finId, asset: apiAsset } : undefined,
    destination: destination ? { finId: destination.finId, asset: apiAsset } : undefined,
    operationType: operationType as components['schemas']['operationType'],
    tradeDetails: tradeDetailsToAPI(tradeDetails),
    transactionDetails: transactionDetailsToAPI(transactionDetails),
    proof: proofPolicyOptToAPI(proof),
  };
};

export const receiptOperationToAPI = (op: ReceiptOperation): components['schemas']['receiptOperation'] => {
  switch (op.type) {
    case 'pending':
      const { correlationId: cid, metadata } = op;
      return {
        isCompleted: false, cid,
        operationMetadata: metadataOptToAPI(metadata),
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
    account: depositPayoutAccountToAPI(account),
    description,
    paymentOptions: paymentOptions ? paymentOptions.map(paymentMethodToAPI) : [],
    operationId,
    details,
  };
};

export const depositOperationToAPI = (op: DepositOperation): components['schemas']['depositOperation'] => {
  switch (op.type) {
    case 'pending':
      const { correlationId: cid, metadata } = op;
      return { isCompleted: false, cid, operationMetadata: metadataOptToAPI(metadata) };
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

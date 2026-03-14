export type LedgerAssetInfo = {
  tokenId: string
  ledgerReference?: LedgerReference
};

export type LedgerReference = {
  type: string;
  network: string;
  address: string;
  tokenStandard: string;
  additionalContractDetails: {
    finP2PEVMOperatorDetails: {
      finP2POperatorContractAddress: string;
      allowanceRequired: boolean;
    };
  };
};

export type AssetIdentifier = {
  type: string
  value: string
};


export type ProofDomain = {
  chainId: number,
  verifyingContract: string
};

export type Proof = {
  type: 'NoProofPolicy'
} | {
  type: 'SignatureProofPolicy',
  verifyingKey: string,
  signatureTemplate: string,
};

export type ProofPolicy = {
  type: 'NoProofPolicy'
} | {
  type: 'SignatureProofPolicy',
  verifyingKey: string,
  signatureTemplate: string,
  domain: ProofDomain | null
};

export type AssetPolicies = {
  proof: Proof
};

export type OssAsset = {
  id: string,
  name: string,
  type: string,
  organizationId: string,
  denomination: {
    code: string
  },
  issuerId: string,
  config: string,
  assetIdentifier: AssetIdentifier;
  allowedIntents: string[],
  regulationVerifiers: {
    id: string,
    name: string,
    provider: string
  }[]
  policies: AssetPolicies
  certificates: {
    nodes: {
      id: string,
      profileId: string,
      type: string,
      data: string,
      expiry: number
    }[]
  }
  ledgerAssetInfo: LedgerAssetInfo
};

export type OssAssetNodes = {
  assets: { nodes: OssAsset[] }
};

export type OssPaymentAsset = {
  id: string
  accountType: string
  orgId: string
  version: number
  assets: {
    code: string
    type: string
    conversions: {
      accountType: {

      }
      symbols: string[]
    }[],
    policies: AssetPolicies
  }[]
};

export type OssEscrow = {
  orgId: string
  paymentAssetId: string
  paymentAsset: OssPaymentAsset
};

export type OssEscrowNodes = {
  escrows: { nodes: OssEscrow[] }
};

export type OssOwner = {
  id: string,
  name: string,
  finIds: string[]
  organizationId: string,
  certificates: {
    nodes: {
      id: string,
      profileId: string,
      type: string,
      data: string,
      expiry: number
    }[]
  }
  holdings: {
    nodes: {
      assetType: string,
      asset: { resourceId: string },
      // asset: { symbol: string } | { code: string } | { resourceId: string },
      balance: string,
    }[]
  }
  metadata: {
    acl: string[]
  }
};

export type OssOwnerNodes = {
  users: { nodes: OssOwner[] }
};

export type OssOrganization = {
  id: string,
  name: string
};

export type OssOrganizationNodes = {
  organizations: { nodes: OssOrganization[] }
};

export type OssLedgerBinding = {
  name: string;
  endpoint: string;
  displayName: string | null;
  requestTimeout: string;
  backoff: string;
  singleRequestTimeout: string;
  balanceSyncAllowed: boolean;
  idempotency: {
    idempotent: boolean;
    transientFailureCodes: string[];
  } | null;
};

export type OssLedgerBindingNodes = {
  ledgers: { nodes: OssLedgerBinding[] }
};

export type OssApprovalConfig = {
  id: string;
  config: string;
  createdAt: string;
};

export type OssApprovalConfigNodes = {
  approvalConfigs: { nodes: OssApprovalConfig[] }
};

// ── Execution Plans ──

export type OssPlanStatus = 'Pending' | 'InProgress' | 'Completed' | 'Failed' | 'Halted' | 'Rejected' | 'Cancelled';

export type OssAssetDetails =
  | { __typename: 'FinP2PAsset'; resourceId: string }
  | { __typename: 'FiatAsset'; code: string }
  | { __typename: 'Cryptocurrency'; symbol: string };

export type OssAccountIdentifier =
  | { __typename: 'FinP2PAssetAccount'; finId: string; orgId: string }
  | { __typename: 'CryptoWalletAccount'; address: string }
  | { __typename: 'Iban'; code: string };

export type OssAccountInstruction = {
  asset: OssAssetDetails;
  identifier: OssAccountIdentifier | null;
};

export type OssAssetOrder = {
  term: { asset: OssAssetDetails; amount: string };
};

export type OssPlanContractDetails = {
  __typename: string;
  asset?: OssAssetOrder;
  settlement?: OssAssetOrder;
};

export type OssPlanInvestor = {
  investor: string;
  role: string;
};

export type OssPlanContract = {
  investors: OssPlanInvestor[];
  contractDetails: OssPlanContractDetails | null;
};

export type OssPlanApproval = {
  planId: string;
  orgId: string;
  status: string;
  statusInfo: { __typename: string } | null;
};

export type OssInstructionApproval = {
  planId: string;
  sequence: number;
  orgId: string;
  status: string;
  reason: string | null;
};

export type OssReceipt = {
  __typename: 'Receipt';
  id: string;
  operationId: string | null;
  transactionId: string | null;
  operationType: string | null;
  source: { id: string; organizationId: string; finIds: string[] };
  destination: { id: string; organizationId: string; finIds: string[] };
  sourceAccount: OssAccountIdentifier | null;
  destinationAccount: OssAccountIdentifier | null;
  quantity: string;
  timestamp: string;
  status: string;
};

export type OssInstructionState =
  | { __typename: 'UnknownState' }
  | { __typename: 'ErrorState'; code: string; message: string }
  | { __typename: 'SuccessState'; output: OssReceipt | null };

export type OssTransition =
  | { __typename: 'SequenceTransition'; sequence: number }
  | { __typename: 'StatusTransition'; status: string };

export type OssInstructionDetails = {
  __typename: string;
  source?: string;
  destination?: string;
  buyer?: string;
  amount?: string;
  holdInstructionSequence?: number;
  waitTime?: number;
  // Aliased account fields (due to nullability conflicts across union members)
  holdSrc?: OssAccountInstruction;
  holdDest?: OssAccountInstruction | null;
  transferSrc?: OssAccountInstruction;
  transferDest?: OssAccountInstruction;
  releaseSrc?: OssAccountInstruction;
  releaseDest?: OssAccountInstruction;
  revertDest?: OssAccountInstruction;
  issueDest?: OssAccountInstruction;
  redeemSrc?: OssAccountInstruction;
};

export type OssPlanInstruction = {
  sequence: number;
  organizations: { organizationId: string }[];
  status: string;
  version: number;
  details: OssInstructionDetails;
  state: OssInstructionState;
  approvals: { nodes: OssInstructionApproval[] };
  transitions: {
    onSuccess: OssTransition[];
    onFailure: OssTransition[];
    onTimeout: OssTransition[];
  };
};

export type OssExecutionPlan = {
  id: string;
  status: OssPlanStatus;
  creationTimestamp: number;
  lastModified: number;
  version: number;
  organizations: { organizationId: string }[];
  intent: {
    id: string;
    type: string;
    status: string;
    remainingQuantity: string | null;
    start: string;
    end: string;
    intent: { __typename: string };
    metadata: { acl: string[] } | null;
  } | null;
  contract: OssPlanContract;
  approvals: OssPlanApproval[];
  instructions: OssPlanInstruction[];
};

export type OssExecutionPlanNodes = {
  plans: { nodes: OssExecutionPlan[] }
};

export const parseProofDomain = (jsonString: string): ProofDomain | null => {
  const rawObject: unknown = JSON.parse(jsonString);

  if (typeof rawObject !== 'object' || rawObject === null) {
    return null;
  }

  const obj: Record<string, unknown> = {};

  for (const key in rawObject) {
    if (Object.prototype.hasOwnProperty.call(rawObject, key)) {
      obj[key.toLowerCase()] = (rawObject as any)[key];
    }
  }

  const verifyingContract = obj.verifyingcontract as string;
  let chainId: number;
  const chainIdVal = obj.chainid;
  if (!verifyingContract || !chainIdVal) {
    return null;
  }
  if (typeof chainIdVal !== 'number') {
    chainId = parseInt(chainIdVal as string);
  } else {
    chainId = chainIdVal;
  }
  return {
    chainId,
    verifyingContract,
  };
};

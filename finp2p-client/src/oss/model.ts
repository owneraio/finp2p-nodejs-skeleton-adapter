export type LedgerAssetInfo = {
  ledgerIdentifier?: Caip19Identifier
  ledgerBinding?: { name: string }
  ledgerReference?: LedgerReference
};

export type Caip19Identifier = {
  network: string;
  standard: string;
  tokenId: string;
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

export type FinancialIdentifier = {
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

export type OssSettlementTerm = {
  details: {
    unitValue?: string;
  } | null;
};

export type OssIntent = {
  id: string;
  remainingQuantity: string | null;
  status: string;
  type: string;
  start: string;
  end: string;
  intent: {
    __typename: string;
    settlementTerm?: OssSettlementTerm;
  };
};

export type OssCertificate = {
  id: string;
  profileId: string;
  type: string;
  data: string;
  issuedAt?: number;
  expiry: number;
  providerId?: string;
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
  financialIdentifier: FinancialIdentifier;
  allowedIntents: string[],
  regulationVerifiers: {
    id: string,
    name: string,
    provider: string
  }[]
  policies: AssetPolicies
  certificates: {
    nodes: OssCertificate[]
  }
  intents?: {
    nodes: OssIntent[]
  }
  ledgerAssetInfo: LedgerAssetInfo
};

export type OssAssetNodes = {
  assets: { nodes: OssAsset[] }
};

/**
 * Legacy payment-asset / escrow types.
 *
 * The `escrows` root query (and the `PaymentAsset` schema graph that hung off it)
 * was removed from the OSS schema in router v0.28. The surviving
 * `OssClient.getPaymentAsset` / `getPaymentAssets` methods are kept for
 * API compatibility but now return empty / throw `ItemNotFoundError`.
 * This type is retained only so callers that still reference it continue to compile.
 */
export type OssPaymentAsset = {
  code: string
  type: string
  policies: AssetPolicies
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
      syncedBalance: string,
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

/**
 * `AssetDetails` union now only includes `FinP2PAsset` (v0.28).
 * `FiatAsset` and `Cryptocurrency` are no longer part of it.
 */
export type OssAssetDetails =
  | { __typename: 'FinP2PAsset'; resourceId: string };

/**
 * `AccountIdentifier` union is `CryptoWalletAccount | FinP2PAccount | Iban` (v0.28).
 * `FinP2PAssetAccount` is no longer a member — `FinP2PAccount` replaces it.
 */
export type OssAccountIdentifier =
  | { __typename: 'FinP2PAccount'; finId: string; orgId: string }
  | { __typename: 'CryptoWalletAccount'; address: string }
  | { __typename: 'Iban'; code: string };

/**
 * Modelled on the `LedgerAccountAsset` schema type — instruction source/destination
 * fields on execution-plan instructions all return this composite now.
 */
export type OssLedgerAccountAsset = {
  finp2pAccount: {
    asset?: { resourceId: string } | null;
    account?: { finId: string; orgId: string } | null;
  };
  networkAccount?: { wallet?: { type: string; address: string } | null } | null;
};

export type OssAssetOrder = {
  term: { amount: string };
  instruction?: {
    sourceAccount?: OssLedgerAccountAsset | null;
    destinationAccount?: OssLedgerAccountAsset | null;
  };
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
  /** Source owner resource ID (now a scalar string, v0.28) */
  source: string | null;
  /** Destination owner resource ID (now a scalar string, v0.28) */
  destination: string | null;
  sourceAccount: OssLedgerAccountAsset | null;
  destinationAccount: OssLedgerAccountAsset | null;
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

/**
 * Union over all instruction detail types (HoldInstruction, TransferInstruction,
 * ReleaseInstruction, RevertHoldInstruction, IssueInstruction, RedeemInstruction,
 * AwaitInstruction). In v0.28 each instruction now exposes `source` / `destination`
 * as `LedgerAccountAsset` objects (not scalars) — aliased in the query to avoid
 * type conflicts across union members.
 */
export type OssInstructionDetails = {
  __typename: string;
  amount?: string;
  holdInstructionSequence?: number;
  waitTime?: number;
  // Aliased account fields (due to nullability conflicts across union members)
  holdSource?: OssLedgerAccountAsset;
  holdDestination?: OssLedgerAccountAsset | null;
  transferSource?: OssLedgerAccountAsset;
  transferDestination?: OssLedgerAccountAsset;
  releaseSource?: OssLedgerAccountAsset;
  releaseDestination?: OssLedgerAccountAsset;
  revertDestination?: OssLedgerAccountAsset;
  issueSource?: OssLedgerAccountAsset | null;
  issueDestination?: OssLedgerAccountAsset;
  redeemSource?: OssLedgerAccountAsset;
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

export type OssReceiptNodes = {
  receipts: { nodes: OssReceipt[] }
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

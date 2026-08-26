export type LedgerAssetInfo = {
  ledgerIdentifier?: Caip19Identifier
  ledgerBinding?: { name: string }
  ledgerReference?: LedgerReference
};

/**
 * `network` and `standard` are nullable upstream (only `tokenId` is non-null in
 * the OSS schema), so they are optional here rather than promising a string the
 * server may not send.
 */
export type Caip19Identifier = {
  network?: string | null;
  standard?: string | null;
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

/**
 * One variant of the OSS `NetworkAccount` union, discriminated by `kind`
 * (an alias of `__typename`; see the `networkAccount` fragment for why it
 * isn't called `type`).
 */
export type OssNetworkAccountVariant =
  | { kind: 'WalletAccount', type: string, address: string }
  | { kind: 'Caip10Account', network: string, address: string }
  | { kind: 'CustodialAccount', provider: string, vaultAccountId: string, assetId?: string | null };

/**
 * An investor's onboarded network account as projected into the OSS read
 * model, scoped to one `(organizationId, assetId)` pair. `id` is the
 * adapter-assigned identifier — the same one `removeInvestorAccount` takes.
 */
export type OssInvestorNetworkAccount = {
  organizationId: string,
  assetId: string,
  id: string,
  account: OssNetworkAccountVariant | null
};

export type OssPageInfo = {
  endCursor: string | null;
  hasNextPage: boolean;
  totalCount: number;
  totalLeft: number;
};

export type OssPaginate = {
  after?: string;
  limit?: number;
  skip?: number;
};

/**
 * Paginated list result. Behaves as a plain `T[]` for backward compatibility
 * (iteration, `.map`, `.filter`, indexing, `.length` all work) and additionally
 * carries the optional `pageInfo` from the OSS GraphQL response.
 */
export type OssPage<T> = T[] & { pageInfo?: OssPageInfo };

export const makeOssPage = <T>(nodes: ArrayLike<T>, pageInfo?: OssPageInfo): OssPage<T> => {
  const page = Array.from(nodes) as OssPage<T>;
  if (pageInfo) page.pageInfo = pageInfo;
  return page;
};

export type OssAssetNodes = {
  assets: { nodes: OssAsset[]; pageInfo?: OssPageInfo }
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
  /** Only selected when the query is run with `includeNetworkAccounts: true`. */
  networkAccounts?: OssInvestorNetworkAccount[] | null
  metadata: {
    acl: string[]
  }
};

export type OssOwnerNodes = {
  users: { nodes: OssOwner[]; pageInfo?: OssPageInfo }
};

export type OssUser = {
  id: string;
  name: string;
  finIds: string[];
  organizationId: string;
};

export type OssUserNodes = {
  users: { nodes: OssUser[]; pageInfo?: OssPageInfo }
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
 * and receipt source/destination fields all return this composite now.
 *
 * `asset.ledgerIdentifier` is the CAIP-19 union (currently single member
 * `Caip19Identifier`); `account.custodian` carries the holding org id when the
 * finId sits behind a custodian.
 */
export type OssLedgerAccountAsset = {
  finp2pAccount: {
    asset?: {
      resourceId: string;
      ledgerIdentifier?: ({ __typename: 'Caip19Identifier' } & Caip19Identifier) | null;
    } | null;
    account?: {
      finId: string;
      orgId: string;
      custodian?: { orgId: string } | null;
    } | null;
  };
  networkAccount?: OssNetworkAccountVariant | null;
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

export type OssReceiptProof =
  | { __typename: 'NoProof' }
  | {
    __typename: 'SignatureProof';
    signature: { signature: string; hashFunction: string; templateType: string };
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
  proof?: OssReceiptProof | null;
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

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

// ── Agreements ──

/**
 * Lifecycle status of an agreement, as the OSS read model reports it.
 *
 * Typed as a union with a `string` arm rather than a closed set: the router
 * owns this vocabulary and adds to it, and a client that fails to parse an
 * unknown status would break on a router upgrade it is supposed to tolerate.
 * The named arms are what autocomplete offers; the `string` arm is what keeps
 * it honest.
 */
export type OssAgreementStatus =
  | 'AGREEMENT_STATUS_DRAFT'
  | 'AGREEMENT_STATUS_PROPOSED'
  | 'AGREEMENT_STATUS_ACTIVE'
  | 'AGREEMENT_STATUS_SUSPENDED'
  | 'AGREEMENT_STATUS_REJECTED'
  | 'AGREEMENT_STATUS_TERMINATED'
  | (string & {});

/** One entry of an agreement's org-level access list. */
export type OssAgreementParticipant = {
  organizationId: string;
  /** Access roles of the organization (Observer, Contributor). */
  roles: string[];
};

/** Binding of an open-string agreement role to the parties that may act for it. */
export type OssAgreementRoleBinding = {
  role: string;
  parties: string[];
};

/** CAIP-19 ledger asset listed as eligible under an agreement. */
export type OssAgreementEligibleAsset = {
  network: string;
  standard: string;
  tokenId: string;
};

/** Consent signature over the contract zone. The signature payload is not exposed. */
export type OssAgreementConsentSignature = {
  /** Consent role the signature satisfies. */
  role: string;
  /** Bound party that signed. */
  signerParty: string;
};

/**
 * One party's refusal, recorded by the owner.
 *
 * A non-empty `rejections` implies `AGREEMENT_STATUS_REJECTED`, but an empty
 * one says nothing on its own: an agreement may also be
 * `AGREEMENT_STATUS_TERMINATED` by running its course. The two terminal
 * statuses mean opposite things, so never infer "not rejected" from
 * "terminated".
 */
export type OssAgreementRejection = {
  /** The organization that refused. */
  orgId: string;
  /** The bound role it refused under; context, not identity. */
  role: string | null;
  /** Machine-readable cause, e.g. `UnsupportedTermsType`. */
  code: string | null;
  reason: string | null;
  /** Epoch seconds. */
  rejectedAt: number | null;
  /** The amendment number that was refused. */
  agreementVersion: number | null;
};

/**
 * An agreement as the OSS read model projects it.
 *
 * `terms` is **base64-encoded and opaque to the network** — the write side
 * takes a JSON object and the read side hands back a string. Decode it with
 * {@link decodeAgreementTerms}, and only once `termsType` says you understand
 * the payload.
 */
export type OssAgreement = {
  /** Agreement resource id (`orgId:107:rawId`). */
  id: string;
  /** Organization owning (originating) the agreement resource. */
  organizationId: string;
  status: OssAgreementStatus;
  /**
   * Position in the definition's state machine. Empty until the machine
   * assigns an initial state on approval, and empty on agreements with no
   * definition. Router-governed: never authored, never amended.
   */
  businessState: string;
  /** Amendment number; contract-zone changes bump it. */
  version: number;
  /** Roles whose signatures bind the agreement. */
  consentRoles: string[];
  participants: OssAgreementParticipant[];
  roles: OssAgreementRoleBinding[];
  eligibleAssets: OssAgreementEligibleAsset[];
  /** Application schema tag telling apps how to parse `terms`, e.g. `repo-terms/v1`. */
  termsType: string;
  /** Base64-encoded application terms payload. */
  terms: string;
  /** Validity window start, epoch seconds. */
  validFrom: number;
  /** Validity window end, epoch seconds. */
  validUntil: number;
  signatures: OssAgreementConsentSignature[];
  rejections: OssAgreementRejection[] | null;
  /** Epoch seconds the owning router first persisted it; 0 when unset. */
  createdAt: number;
  /**
   * Epoch seconds of the owning router's last write; 0 when unset, and never
   * moving back. Several writes can share a second, so to find changes since a
   * time, filter with `GTE` and de-duplicate by `id`.
   */
  updatedAt: number;
};

export type OssAgreementNodes = {
  agreements: { nodes: OssAgreement[] | null; pageInfo?: OssPageInfo }
};

/**
 * Decode an agreement's base64 `terms` into the application payload.
 *
 * Returns `undefined` rather than throwing when the payload is absent, is not
 * valid base64, or is not JSON. Terms are written by whichever application
 * owns `termsType` and this client does not own that contract, so a payload it
 * cannot parse is a fact about the agreement, not an error in the caller — and
 * a lookup that scans many agreements must not die on one bad row.
 *
 * Check `termsType` before trusting the shape: the generic parameter is an
 * assertion by the caller, not a validation.
 */
export const decodeAgreementTerms = <T = Record<string, unknown>>(
  agreement: Pick<OssAgreement, 'terms'>,
): T | undefined => {
  if (!agreement.terms) return undefined;
  try {
    return JSON.parse(Buffer.from(agreement.terms, 'base64').toString('utf8')) as T;
  } catch {
    return undefined;
  }
};

/** Ordering for {@link OssAgreement} lookups. Defaults to id when omitted. */
export type OssAgreementOrder = {
  field?: 'CREATED_AT' | 'UPDATED_AT' | 'ID';
  direction?: 'ASC' | 'DESC';
};

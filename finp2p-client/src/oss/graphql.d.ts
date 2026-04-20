export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

/** Account identifier - supports FinP2P, crypto wallets, and IBAN */
export type AccountIdentifier = CryptoWalletAccount | FinP2PAccount | Iban;

export enum ActionType {
  Request = 'request',
  Send = 'send',
  Unknown = 'unknown'
}

export type AdditionalContractDetails = {
  __typename?: 'AdditionalContractDetails';
  finP2PEVMOperatorDetails?: Maybe<FinP2PevmOperatorDetails>;
};

/** Apply an aggregation function on specified Object's field. */
export type Aggregate = {
  /** Object's field to which apply the AggregateFunc */
  field?: InputMaybe<Scalars['String']['input']>;
  /** AggregateFunc to apply on the provided Field. */
  func: AggregateFunc;
};

/** Aggregation function to be applied on Object's numeric field. */
export enum AggregateFunc {
  Avg = 'AVG',
  Count = 'COUNT',
  Max = 'MAX',
  Min = 'MIN',
  Sum = 'SUM'
}

/** Result of Aggregation function applied on an Object numeric field. */
export type AggregateResult = {
  __typename?: 'AggregateResult';
  /** The Object's field which this results refer to. */
  field: Scalars['String']['output'];
  /** The AggregateFunc which this AggregateResult refers to. */
  func: AggregateFunc;
  result: Scalars['String']['output'];
};

export type ApprovalConfig = {
  __typename?: 'ApprovalConfig';
  config: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  /** proposal approval configuration */
  id: Scalars['String']['output'];
};

export type ApprovalConfigs = {
  __typename?: 'ApprovalConfigs';
  nodes?: Maybe<Array<ApprovalConfig>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

export enum ApprovalStatus {
  Approved = 'Approved',
  Rejected = 'Rejected',
  Unknown = 'Unknown'
}

/** Represents an Asset in the network. */
export type Asset = Profile & {
  __typename?: 'Asset';
  /** to fallback to default allowed policy if no specific policy is set */
  allowPolicyDefaultFallback: Scalars['Boolean']['output'];
  /** Allowed intent types to be used on the asset */
  allowedIntents?: Maybe<Array<IntentTypes>>;
  /** whether the asset is auto-shared */
  autoShare: Scalars['Boolean']['output'];
  /** Collection of certificates associated with the Profile. */
  certificates: Certificates;
  /** Custom configuration for the Asset. */
  config: Scalars['String']['output'];
  /** decimal places for the asset */
  decimalPlaces: Scalars['Int']['output'];
  /** Denomination currency of the Asset */
  denomination: FiatAsset;
  /** classification standard used to identify the financial asset */
  financialIdentifier?: Maybe<FinancialIdentifier>;
  id: Scalars['String']['output'];
  /** Collection of Intents associated with the Asset. */
  intents: Intents;
  /** Tokens issued for the given Asset. */
  issuedTokens: TokensBalances;
  /** Issuer profile of the Asset. */
  issuerId: Scalars['String']['output'];
  /** ledgerAssetInfo information */
  ledgerAssetInfo?: Maybe<LedgerAssetInfo>;
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  name: Scalars['String']['output'];
  /** omnibus account for the asset, if applicable */
  orgSettlementAccount?: Maybe<NetworkAccount>;
  /** Organization id to whom this profile is associated with. */
  organizationId: Scalars['String']['output'];
  /** Describe the policies active on the asset */
  policies?: Maybe<AssetPolicies>;
  /** Regulation Verifiers associated with the Asset. */
  regulationVerifiers?: Maybe<Array<Verifier>>;
  symbol?: Maybe<Scalars['String']['output']>;
  /** Type of Asset (Share, Debt etc..) */
  type: Scalars['String']['output'];
  /** asset resource version */
  version: Scalars['String']['output'];
};


/** Represents an Asset in the network. */
export type AssetCertificatesArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};


/** Represents an Asset in the network. */
export type AssetIntentsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};


/** Represents an Asset in the network. */
export type AssetIssuedTokensArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};

/** Identifier type for asset data */
export enum AssetDataIdentifierType {
  Caip19 = 'CAIP19',
  Isin = 'ISIN'
}

/** Represents financial data for an asset from a data provider */
export type AssetDataItem = {
  __typename?: 'AssetDataItem';
  /** When the record was created */
  createdAt: Scalars['Int']['output'];
  /** The actual data as JSON string */
  data: Scalars['String']['output'];
  /** Type of financial data */
  dataType: DataType;
  id: Scalars['String']['output'];
  /** Type of identifier used (ISIN or CAIP19) */
  identifierType: AssetDataIdentifierType;
  /** The identifier value (e.g., US0378331005 for ISIN) */
  identifierValue: Scalars['String']['output'];
  /** Provider timestamp (epoch ms) */
  providerTimestamp?: Maybe<Scalars['Int']['output']>;
  /** Data provider source identifier */
  source?: Maybe<Scalars['String']['output']>;
  /** When the record was last updated */
  updatedAt: Scalars['Int']['output'];
};

/** Results for asset data query. */
export type AssetDatas = {
  __typename?: 'AssetDatas';
  /** Collection of AssetDataItem Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<AssetDataItem>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Asset details - now always FinP2P */
export type AssetDetails = FinP2PAsset;

export type AssetIssuer = {
  __typename?: 'AssetIssuer';
  assetId: Scalars['String']['output'];
  issuerId: Scalars['String']['output'];
};

export type AssetOrder = {
  __typename?: 'AssetOrder';
  instruction: AssetOrderInstruction;
  term: AssetOrderTerm;
};

export enum AssetOrderField {
  /** Assets order by determined by Name field */
  Name = 'NAME',
  /** Assets order by determined by OrganizationId field */
  Organization = 'ORGANIZATION'
}

export type AssetOrderInput = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<AssetOrderField>;
};

export type AssetOrderInstruction = {
  __typename?: 'AssetOrderInstruction';
  destinationAccount?: Maybe<LedgerAccountAsset>;
  sourceAccount?: Maybe<LedgerAccountAsset>;
};

export type AssetOrderTerm = {
  __typename?: 'AssetOrderTerm';
  amount: Scalars['String']['output'];
};

export type AssetPolicies = {
  __typename?: 'AssetPolicies';
  proof: ProofPolicy;
};

/** Refresh configuration for an asset's data from a provider */
export type AssetRefreshConfigItem = {
  __typename?: 'AssetRefreshConfigItem';
  createdAt: Scalars['Int']['output'];
  dataType: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  identifierType: AssetDataIdentifierType;
  identifierValue: Scalars['String']['output'];
  lastRefreshAt?: Maybe<Scalars['Int']['output']>;
  nextRefreshAt?: Maybe<Scalars['Int']['output']>;
  /** UUID of the data provider */
  providerId?: Maybe<Scalars['String']['output']>;
  refreshInterval: Scalars['String']['output'];
  updatedAt: Scalars['Int']['output'];
};

export type AssetTerm = {
  __typename?: 'AssetTerm';
  /** Total amount of asset allocated */
  amount: Scalars['String']['output'];
};

export enum AssetType {
  Cryptocurrency = 'cryptocurrency',
  Fiat = 'fiat',
  Finp2p = 'finp2p'
}

/** Results for asset query. */
export type Assets = {
  __typename?: 'Assets';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Asset Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Asset>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type Attachment = {
  __typename?: 'Attachment';
  link?: Maybe<Scalars['String']['output']>;
  messageId: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  uuid: Scalars['String']['output'];
};

export type AwaitInstruction = {
  __typename?: 'AwaitInstruction';
  /** epoch time for await instruction */
  waitTime: Scalars['Int']['output'];
};

export type BuyingContractDetails = {
  __typename?: 'BuyingContractDetails';
  asset: AssetOrder;
  settlement?: Maybe<AssetOrder>;
};

export type BuyingIntent = {
  __typename?: 'BuyingIntent';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the buyer */
  buyer?: Maybe<Scalars['String']['output']>;
  /** Destination account - where buyer receives the asset */
  destination: FinP2PAssetAccount;
  settlementInstruction: BuyingSettlementInstruction;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  signaturePolicy: BuyingSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
};

export type BuyingSettlementInstruction = {
  __typename?: 'BuyingSettlementInstruction';
  /** Source account where buyer pays from */
  account?: Maybe<FinP2PAssetAccount>;
};

export type BuyingSignaturePolicy = ManualIntentSignaturePolicy | PresignedBuyingIntentSignaturePolicy;

/** CAIP-19 format ledger identifier */
export type Caip19Identifier = {
  __typename?: 'Caip19Identifier';
  /** CAIP-2 network identifier (e.g., eip155:1, solana:mainnet) */
  network: Scalars['String']['output'];
  /** Token standard (e.g., erc20, erc721) */
  standard: Scalars['String']['output'];
  /** Token ID or contract address */
  tokenId: Scalars['String']['output'];
};

/** Represents a Certificate in the network. */
export type Certificate = {
  __typename?: 'Certificate';
  /** Semi-Structured Data provided as additional information for the Certificate. */
  data?: Maybe<Scalars['String']['output']>;
  /** Certificate associated documents metadata. */
  documents: Documents;
  expiry?: Maybe<Scalars['Int']['output']>;
  id: Scalars['String']['output'];
  issuedAt: Scalars['Int']['output'];
  /** Profile to whom this Certificate is associate with. */
  profileId: Scalars['String']['output'];
  /** Service Provider Id which provided the Certificate. */
  providerId: Scalars['String']['output'];
  /** Type of Certificate (KYA,KYC,AML etc.. ). */
  type: Scalars['String']['output'];
};


/** Represents a Certificate in the network. */
export type CertificateDocumentsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export type CertificateOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<CertificateOrderField>;
};

export enum CertificateOrderField {
  /** certificates order by determined by Id field */
  Id = 'ID'
}

/** Results for certificates query. */
export type Certificates = {
  __typename?: 'Certificates';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Certificate Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Certificate>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type CloseAmountRate = {
  __typename?: 'CloseAmountRate';
  repaymentVolume: Scalars['String']['output'];
};

export type ContractDetails = {
  __typename?: 'ContractDetails';
  additionalContractDetails?: Maybe<AdditionalContractDetails>;
  address: Scalars['String']['output'];
  network: Scalars['String']['output'];
  tokenStandard?: Maybe<Scalars['String']['output']>;
};

export type Correspondent = AssetIssuer;

/** Crypto wallet account */
export type CryptoWalletAccount = {
  __typename?: 'CryptoWalletAccount';
  /** Wallet address represented as a hexadecimal string prefixed with 0x */
  address: Scalars['String']['output'];
};

export type Custodian = {
  __typename?: 'Custodian';
  orgId: Scalars['String']['output'];
};

export type CustodyProvider = {
  __typename?: 'CustodyProvider';
  backoff: Scalars['String']['output'];
  displayName?: Maybe<Scalars['String']['output']>;
  endpoint: Scalars['String']['output'];
  idempotency?: Maybe<LedgerIdempotencyOptions>;
  name: Scalars['String']['output'];
  requestTimeout: Scalars['String']['output'];
  singleRequestTimeout: Scalars['String']['output'];
};

export type CustodyProviders = {
  __typename?: 'CustodyProviders';
  /** Collection of Custody Provider Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<CustodyProvider>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

export type DataAccess = {
  __typename?: 'DataAccess';
  /** data access type */
  accessType: DataAccessType;
  /** status of the shared resource data access */
  status: Scalars['String']['output'];
  /** organization id the resource shared with */
  targetOrgId: Scalars['String']['output'];
};

export enum DataAccessType {
  Balance = 'Balance',
  Unknown = 'Unknown'
}

/** Represents a data provider binding configuration */
export type DataProviderBinding = {
  __typename?: 'DataProviderBinding';
  backoff: Scalars['String']['output'];
  createdAt: Scalars['Int']['output'];
  /** JSON string of per-data-type fetch configuration */
  dataTypeConfig?: Maybe<Scalars['String']['output']>;
  /** JSON array of data type strings this provider serves */
  dataTypes?: Maybe<Array<Scalars['String']['output']>>;
  displayName?: Maybe<Scalars['String']['output']>;
  endpoint: Scalars['String']['output'];
  /** Unique identifier (UUID) for the data provider */
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  /** Type of data provider: adapter (external HTTP) or finp2p (internal P2P) */
  providerType: Scalars['String']['output'];
  requestTimeout: Scalars['String']['output'];
  updatedAt: Scalars['Int']['output'];
};

/** Results for data provider query. */
export type DataProviderBindings = {
  __typename?: 'DataProviderBindings';
  /** Collection of DataProviderBinding Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<DataProviderBinding>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Represents a data rule mapping an asset identifier to a data provider */
export type DataRuleItem = {
  __typename?: 'DataRuleItem';
  /** When the rule was created (epoch seconds) */
  createdAt: Scalars['Int']['output'];
  /** The data type this rule covers */
  dataType: Scalars['String']['output'];
  /** Whether this rule is active */
  enabled: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  /** Type of identifier (e.g., ISIN) */
  identifierType: Scalars['String']['output'];
  /** The identifier value (e.g., US0378331005) */
  identifierValue: Scalars['String']['output'];
  /** UUID of the data provider */
  providerId: Scalars['String']['output'];
  /** Refresh interval for this rule (e.g., 1h, 24h, RT) */
  refreshInterval?: Maybe<Scalars['String']['output']>;
  /** When the rule was last updated (epoch seconds) */
  updatedAt: Scalars['Int']['output'];
};

/** Results for data rules query. */
export type DataRules = {
  __typename?: 'DataRules';
  /** Collection of DataRuleItem Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<DataRuleItem>>;
  /** Keeps pagination info in-case limit input was provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Financial data types provided by data providers */
export enum DataType {
  AssetHeader = 'assetHeader',
  CorporateActions = 'corporateActions',
  Fundamentals = 'fundamentals',
  MarketData = 'marketData',
  Pricing = 'pricing',
  Ratings = 'ratings',
  ReferenceData = 'referenceData'
}

export type Delivered = {
  __typename?: 'Delivered';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type DeliveryStatus = Delivered | NotDelivered | PendingDelivery;

/** Certificate related Document metadata informaiton */
export type Document = {
  __typename?: 'Document';
  id: Scalars['String']['output'];
  mimeType: Scalars['String']['output'];
  name: Scalars['String']['output'];
  /** Locaiton of document content. */
  uri: Scalars['String']['output'];
};

/** Results for documents query. */
export type Documents = {
  __typename?: 'Documents';
  /** Collection of Document Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Document>>;
};

export type Eip712Template = {
  __typename?: 'EIP712Template';
  hash: Scalars['String']['output'];
};

export type ErrorState = {
  __typename?: 'ErrorState';
  code: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

export type ExecutionContext = {
  __typename?: 'ExecutionContext';
  /** ExecutionPlan associated with the transaction */
  executionPlanId?: Maybe<Scalars['String']['output']>;
  /** The associated instruction sequence number */
  instructionSequenceNumber?: Maybe<Scalars['Int']['output']>;
};

/** Information about organization in an Execution Plan context */
export type ExecutionOrganization = {
  __typename?: 'ExecutionOrganization';
  organizationId: Scalars['String']['output'];
};

export type ExecutionPlan = {
  __typename?: 'ExecutionPlan';
  /** list of plan approvals */
  approvals: Array<Maybe<PlanApproval>>;
  /** plan's contract details */
  contract: ExecutionPlanContract;
  /** plan creation (timestamp in sec) */
  creationTimestamp: Scalars['Int']['output'];
  /** resource id of execution plan */
  id: Scalars['String']['output'];
  /** plan's list of instructions */
  instructions: Array<Maybe<ExecutionPlanInstruction>>;
  /** Intent associated with execution plan */
  intent?: Maybe<Intent>;
  /** last time plan was modified (epoch time seconds) */
  lastModified: Scalars['Int']['output'];
  /** organizations which participate in the execution plan */
  organizations: Array<ExecutionOrganization>;
  /** lifecycle status of the execution plan */
  status: ExecutionPlanStatus;
  /** version of the execution plan */
  version: Scalars['Int']['output'];
};

export type ExecutionPlanContract = {
  __typename?: 'ExecutionPlanContract';
  contractDetails?: Maybe<ExecutionPlanContractDetails>;
  investors: Array<ExecutionPlanInvestor>;
};

export type ExecutionPlanContractDetails = BuyingContractDetails | IssuanceContractDetails | LoanContractDetails | PrivateOfferContractDetails | RedemptionContractDetails | RequestForTransferContractDetails | SellingContractDetails | TransferContractDetails;

export type ExecutionPlanInstruction = {
  __typename?: 'ExecutionPlanInstruction';
  approvals: InstructionApprovals;
  details: InstructionDetails;
  organizations: Array<ExecutionOrganization>;
  sequence: Scalars['Int']['output'];
  state: InstructionCompletionState;
  status: ExecutionPlanInstructionStatus;
  transitions: InstructionTransition;
  version: Scalars['Int']['output'];
  workflows: Array<Workflow>;
};


export type ExecutionPlanInstructionApprovalsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export enum ExecutionPlanInstructionStatus {
  Approved = 'Approved',
  Cancelled = 'Cancelled',
  Completed = 'Completed',
  Failed = 'Failed',
  Pending = 'Pending',
  Rejected = 'Rejected',
  Unknown = 'Unknown'
}

export type ExecutionPlanInstructions = {
  __typename?: 'ExecutionPlanInstructions';
  nodes?: Maybe<Array<ExecutionPlanInstruction>>;
};

export type ExecutionPlanInvestor = {
  __typename?: 'ExecutionPlanInvestor';
  investor: Scalars['String']['output'];
  role: InvestorRole;
};

export type ExecutionPlanOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<ExecutionPlanOrderField>;
};

export enum ExecutionPlanOrderField {
  CreationTimestamp = 'CREATION_TIMESTAMP',
  /** plan order by PlanId field */
  PlanId = 'PLAN_ID'
}

export enum ExecutionPlanStatus {
  Approved = 'Approved',
  Cancelled = 'Cancelled',
  Completed = 'Completed',
  Failed = 'Failed',
  Halted = 'Halted',
  InProgress = 'InProgress',
  Pending = 'Pending',
  Rejected = 'Rejected',
  Unknown = 'Unknown'
}

export type ExecutionsPlans = {
  __typename?: 'ExecutionsPlans';
  nodes?: Maybe<Array<ExecutionPlan>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Fiat currency asset for denomination purposes */
export type FiatAsset = {
  __typename?: 'FiatAsset';
  /** ISO-4217 code of the fiat currency */
  code: Scalars['String']['output'];
};

export type Field = {
  __typename?: 'Field';
  name: Scalars['String']['output'];
  type: Scalars['String']['output'];
  value: Scalars['String']['output'];
};

/**
 * Filter capabilities that can be applied on queries which return multiple results of a given Entity.
 * Currently filtering is available only on the fields which belongs to the Root of the entity
 * and not on nested entities' fields.
 */
export type Filter = {
  /** The Object's key to which apply the filter rule. */
  key: Scalars['String']['input'];
  /** Operator to apply on the specified key and provided value. */
  operator: Operator;
  /** The Value to be used by the Filter Operator. */
  value: Scalars['String']['input'];
};

/** FinP2P account - represents a user account in the FinP2P network */
export type FinP2PAccount = {
  __typename?: 'FinP2PAccount';
  /** Custodian for the finId */
  custodian?: Maybe<Custodian>;
  /** FinId -- a user's public key represented as a hexadecimal string */
  finId: Scalars['String']['output'];
  /** Organization id of the account */
  orgId: Scalars['String']['output'];
};

/** FinP2P asset with resource ID and ledger identifier */
export type FinP2PAsset = {
  __typename?: 'FinP2PAsset';
  /** Ledger identifier for the asset */
  ledgerIdentifier?: Maybe<LedgerIdentifier>;
  /** Resource ID of the FinP2P asset */
  resourceId: Scalars['String']['output'];
};

/** FinP2P asset account - combines asset info with account info (matches proto FinP2PAssetAccount) */
export type FinP2PAssetAccount = {
  __typename?: 'FinP2PAssetAccount';
  /** FinP2P account information */
  account?: Maybe<FinP2PAccount>;
  /** FinP2P asset information */
  asset?: Maybe<FinP2PAsset>;
};

export type FinP2PevmOperatorDetails = {
  __typename?: 'FinP2PEVMOperatorDetails';
  allowanceRequired: Scalars['Boolean']['output'];
  finP2POperatorContractAddress: Scalars['String']['output'];
};

/** Aggregated view of a financial asset identified by ISIN */
export type FinancialAsset = {
  __typename?: 'FinancialAsset';
  /** CAIP19 identifiers — asset instances on different networks/blockchains (from assetHeader data) */
  caip19Identifiers: Array<Scalars['String']['output']>;
  /** Financial data items from data adapters for this ISIN */
  dataItems: Array<AssetDataItem>;
  /** ISIN identifier value (e.g., US0378331005) */
  isin: Scalars['String']['output'];
  /** FinP2P assets linked by matching ISIN identifier (may be empty) */
  linkedAssets: Array<Asset>;
  /** Refresh configurations for this ISIN */
  refreshConfigs: Array<AssetRefreshConfigItem>;
};


/** Aggregated view of a financial asset identified by ISIN */
export type FinancialAssetDataItemsArgs = {
  dataTypes?: InputMaybe<Array<DataType>>;
};

/** Results for financial asset query. */
export type FinancialAssets = {
  __typename?: 'FinancialAssets';
  nodes?: Maybe<Array<FinancialAsset>>;
  pageInfo?: Maybe<PageInfo>;
};

export type FinancialIdentifier = {
  __typename?: 'FinancialIdentifier';
  type: FinancialIdentifierType;
  value: Scalars['String']['output'];
};

export enum FinancialIdentifierType {
  Custom = 'CUSTOM',
  Isin = 'ISIN',
  Iso4217 = 'ISO4217',
  Unspecified = 'UNSPECIFIED'
}

export type FullSettlement = {
  __typename?: 'FullSettlement';
  amount: Scalars['String']['output'];
};

export type HashGroup = {
  __typename?: 'HashGroup';
  fields: Array<Field>;
  hash: Scalars['String']['output'];
};

export type HashlistTemplate = {
  __typename?: 'HashlistTemplate';
  hash: Scalars['String']['output'];
  hashGroups: Array<HashGroup>;
};

export type HoldInstruction = {
  __typename?: 'HoldInstruction';
  /** asset's hold amount */
  amount: Scalars['String']['output'];
  /** destination account information */
  destination?: Maybe<LedgerAccountAsset>;
  /** source account information */
  source: LedgerAccountAsset;
};

export type Holding = {
  __typename?: 'Holding';
  account: FinP2PAccount;
  asset: AssetDetails;
  assetType: AssetType;
  availableBalance: Scalars['String']['output'];
  balance: Scalars['String']['output'];
  balanceTimestamp: Scalars['Int']['output'];
  syncedAvailableBalance: Scalars['String']['output'];
  syncedBalance: Scalars['String']['output'];
  syncedHeldBalance: Scalars['String']['output'];
  withheldBalance: Scalars['String']['output'];
};

/** Fields to subscribe on */
export enum HoldingFields {
  AvailableBalance = 'AvailableBalance',
  Balance = 'Balance',
  SyncedAvailableBalance = 'SyncedAvailableBalance',
  SyncedBalance = 'SyncedBalance',
  SyncedHeldBalance = 'SyncedHeldBalance',
  WithheldBalance = 'WithheldBalance'
}

export type Holdings = {
  __typename?: 'Holdings';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Funds balance objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Holding>>;
};

export enum HttpSchemas {
  Http1_1 = 'HTTP1_1',
  Http2 = 'HTTP2'
}

/** IBAN bank account */
export type Iban = {
  __typename?: 'Iban';
  /** IBAN code */
  code: Scalars['String']['output'];
};

export type IncomingMessage = {
  __typename?: 'IncomingMessage';
  message?: Maybe<Message>;
};

export type InstructionApproval = {
  __typename?: 'InstructionApproval';
  orgId: Scalars['String']['output'];
  planId: Scalars['String']['output'];
  reason: Scalars['String']['output'];
  sequence: Scalars['Int']['output'];
  status: Scalars['String']['output'];
};

/** Results for Instruction Approval query. */
export type InstructionApprovals = {
  __typename?: 'InstructionApprovals';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Instruction Approval Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<InstructionApproval>>;
};

export type InstructionCompletionState = ErrorState | SuccessState | UnknownState;

export type InstructionDetails = AwaitInstruction | HoldInstruction | IssueInstruction | RedeemInstruction | ReleaseInstruction | RevertHoldInstruction | TransferInstruction;

export type InstructionTransition = {
  __typename?: 'InstructionTransition';
  onFailure?: Maybe<Transition>;
  onSuccess?: Maybe<Transition>;
  onTimeout?: Maybe<Transition>;
};

/** Represent an Asset's Transaction Intent occasion in which the Asset's tokens are issued. */
export type Intent = {
  __typename?: 'Intent';
  /** End time of the intent. */
  end: Scalars['Int']['output'];
  id: Scalars['String']['output'];
  /** Intent data */
  intent?: Maybe<IntentDetails>;
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  /** Remaining quantity in the transaction. */
  remainingQuantity: Scalars['String']['output'];
  /** Start time of the intent. */
  start: Scalars['Int']['output'];
  /** Intent status */
  status: IntentStatus;
  /** Intent type: primary sale, buying or selling intent */
  type: Scalars['String']['output'];
  /** intent resource version */
  version: Scalars['String']['output'];
};

export type IntentDetails = BuyingIntent | LoanIntent | PrimarySale | PrivateOfferIntent | RedemptionIntent | RequestForTransferIntent | SellingIntent;

export enum IntentStatus {
  Active = 'ACTIVE',
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Expired = 'EXPIRED',
  NonActive = 'NON_ACTIVE',
  Rejected = 'REJECTED'
}

export enum IntentTypes {
  Buying = 'BUYING',
  Loan = 'LOAN',
  PrimarySale = 'PRIMARY_SALE',
  PrivateOffer = 'PRIVATE_OFFER',
  RequestForTransfer = 'REQUEST_FOR_TRANSFER',
  Selling = 'SELLING'
}

/** Results for itents query. */
export type Intents = {
  __typename?: 'Intents';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Intent Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Intent>>;
};

export type InterestRate = {
  __typename?: 'InterestRate';
  annualPercentageRate: Scalars['String']['output'];
};

export type Investor = {
  __typename?: 'Investor';
  resourceId: Scalars['String']['output'];
};

export enum InvestorRole {
  Borrower = 'BORROWER',
  Buyer = 'BUYER',
  Issuer = 'ISSUER',
  Lender = 'LENDER',
  Seller = 'SELLER'
}

export type IssuanceContractDetails = {
  __typename?: 'IssuanceContractDetails';
  asset: AssetOrder;
  settlement?: Maybe<AssetOrder>;
};

export type IssueInstruction = {
  __typename?: 'IssueInstruction';
  /** asset's issuance amount */
  amount: Scalars['String']['output'];
  /** destination account for issuance */
  destination: LedgerAccountAsset;
  /** source for issuance */
  source?: Maybe<LedgerAccountAsset>;
};

/** Represents an Issuer in the network. */
export type Issuer = {
  __typename?: 'Issuer';
  /** Assets issued by the Issuer. */
  assets: Assets;
  id: Scalars['String']['output'];
  outbox?: Maybe<OutgoingMessages>;
};


/** Represents an Issuer in the network. */
export type IssuerAssetsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** Represents an Issuer in the network. */
export type IssuerOutboxArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export type IssuerOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<IssuerOrderField>;
};

export enum IssuerOrderField {
  /** issuers order by determined by Id field */
  Id = 'ID'
}

/** Results for issuers query. */
export type Issuers = {
  __typename?: 'Issuers';
  /** Collection of Issuer Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Issuer>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Ledger account asset - combines FinP2P account with optional network account */
export type LedgerAccountAsset = {
  __typename?: 'LedgerAccountAsset';
  /** FinP2P asset account */
  finp2pAccount: FinP2PAssetAccount;
  /** Network account (e.g., wallet) */
  networkAccount?: Maybe<NetworkAccount>;
};

export type LedgerApiKeyOptions = {
  __typename?: 'LedgerApiKeyOptions';
  apiKey: Scalars['String']['output'];
};

export type LedgerAssetInfo = {
  __typename?: 'LedgerAssetInfo';
  ledgerBinding?: Maybe<LedgerBinding>;
  ledgerIdentifier?: Maybe<LedgerIdentifier>;
  ledgerReference?: Maybe<LedgerReference>;
};

export type LedgerAuthOptions = LedgerApiKeyOptions | LedgerMtlsOptions | LedgerOAuthOptions;

export enum LedgerAuthType {
  ApiKey = 'API_KEY',
  Mtls = 'MTLS',
  Oauth = 'OAUTH'
}

export type LedgerBinding = {
  __typename?: 'LedgerBinding';
  backoff: Scalars['String']['output'];
  balanceSyncAllowed: Scalars['Boolean']['output'];
  displayName?: Maybe<Scalars['String']['output']>;
  endpoint: Scalars['String']['output'];
  idempotency?: Maybe<LedgerIdempotencyOptions>;
  name: Scalars['String']['output'];
  requestTimeout: Scalars['String']['output'];
  singleRequestTimeout: Scalars['String']['output'];
};

export type LedgerBindings = {
  __typename?: 'LedgerBindings';
  /** Collection of Ledger Binding Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<LedgerBinding>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type LedgerIdempotencyOptions = {
  __typename?: 'LedgerIdempotencyOptions';
  idempotent: Scalars['Boolean']['output'];
  transientFailureCodes: Array<Scalars['String']['output']>;
};

/** Ledger identifier union - currently only CAIP-19 supported */
export type LedgerIdentifier = Caip19Identifier;

export type LedgerMtlsOptions = {
  __typename?: 'LedgerMtlsOptions';
  caCertificate: Scalars['String']['output'];
  clientCertificate: Scalars['String']['output'];
  key: Scalars['String']['output'];
};

export type LedgerOAuthOptions = {
  __typename?: 'LedgerOAuthOptions';
  alg: Scalars['String']['output'];
  jwtKey: Scalars['String']['output'];
  oauthClientId: Scalars['String']['output'];
  oauthClientSecret: Scalars['String']['output'];
  oauthServerEndpoint: Scalars['String']['output'];
};

export type LedgerReference = ContractDetails;

export type LoanConditions = CloseAmountRate | InterestRate | RepaymentTerm;

export type LoanContractDetails = {
  __typename?: 'LoanContractDetails';
  asset: LoanOrder;
  instruction?: Maybe<LoanInstruction>;
  settlement?: Maybe<LoanOrder>;
};

export type LoanInstruction = {
  __typename?: 'LoanInstruction';
  closeDate: Scalars['Int']['output'];
  loanConditions: LoanConditions;
  openDate: Scalars['Int']['output'];
};

export type LoanIntent = {
  __typename?: 'LoanIntent';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the borrower */
  borrower: Scalars['String']['output'];
  /** Borrower's account for the loan asset */
  borrowerAccount: FinP2PAssetAccount;
  /** resource id of the lender */
  lender: Scalars['String']['output'];
  /** Lender's account for the loan asset */
  lenderAccount: FinP2PAssetAccount;
  loanInstruction: LoanInstruction;
  /** Signature policy type */
  loanSettlementInstruction: LoanSettlementInstruction;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  signaturePolicy: LoanSignaturePolicy;
  signaturePolicyType: SignaturePolicyType;
};

export type LoanOrder = {
  __typename?: 'LoanOrder';
  instruction: LoanOrderInstruction;
  term: AssetOrderTerm;
};

export type LoanOrderInstruction = {
  __typename?: 'LoanOrderInstruction';
  borrowerAccount?: Maybe<LedgerAccountAsset>;
  lenderAccount?: Maybe<LedgerAccountAsset>;
};

export type LoanSettlementInstruction = {
  __typename?: 'LoanSettlementInstruction';
  /** Borrower's account for settlement */
  borrowerAccount?: Maybe<FinP2PAssetAccount>;
  /** Lender's account for settlement */
  lenderAccount?: Maybe<FinP2PAssetAccount>;
};

export type LoanSignaturePolicy = PresignedLoanIntentSignaturePolicy;

export type ManualIntentSignaturePolicy = {
  __typename?: 'ManualIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type Message = {
  __typename?: 'Message';
  attachments: Array<Attachment>;
  body: Scalars['String']['output'];
  correspondent: Correspondent;
  id: Scalars['String']['output'];
  subject: Scalars['String']['output'];
  timestamp: Scalars['String']['output'];
};

export type MessageRecipient = {
  __typename?: 'MessageRecipient';
  deliveryStatus?: Maybe<DeliveryStatus>;
  destination: Recipient;
};

export type MessageRecipients = {
  __typename?: 'MessageRecipients';
  /** Collection of User Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<MessageRecipient>>;
};

export type Messages = {
  __typename?: 'Messages';
  nodes?: Maybe<Array<Message>>;
};

/** Network account - represents external network accounts like wallets */
export type NetworkAccount = {
  __typename?: 'NetworkAccount';
  /** Wallet account if present */
  wallet?: Maybe<WalletAccount>;
};

export type NoProof = {
  __typename?: 'NoProof';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type NoProofPolicy = {
  __typename?: 'NoProofPolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type NoSettlement = {
  __typename?: 'NoSettlement';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type NodeAddress = {
  __typename?: 'NodeAddress';
  /** address value */
  address: Scalars['String']['output'];
  /** node port */
  port: Scalars['Int']['output'];
  /** supported http schemas */
  schemas: Array<HttpSchemas>;
};

export type NotDelivered = {
  __typename?: 'NotDelivered';
  status: Scalars['String']['output'];
};

export enum OperationType {
  Hold = 'Hold',
  Issue = 'Issue',
  Redeem = 'Redeem',
  Release = 'Release',
  Transfer = 'Transfer',
  Unknown = 'Unknown'
}

/** Operators available to be used  */
export enum Operator {
  /** Contains */
  Contains = 'CONTAINS',
  /** Equals */
  Eq = 'EQ',
  /** Greater Than */
  Gt = 'GT',
  /** Greater Than or Equals */
  Gte = 'GTE',
  /** In */
  In = 'IN',
  /** Less Than */
  Lt = 'LT',
  /** Less Than or Equals */
  Lte = 'LTE',
  /** Not Equals */
  Neq = 'NEQ',
  /** Not In */
  Nin = 'NIN'
}

/** Organization's information. */
export type Organization = {
  __typename?: 'Organization';
  /** Assets which the Organization act as the Primary Node. */
  assets: Assets;
  /** Organization's cluster id. */
  clusterId: Scalars['String']['output'];
  /** Organization's finp2p public key represented as a hexadecimal string. */
  finId: Scalars['String']['output'];
  id: Scalars['String']['output'];
  /** Organization's name on the finp2p network. */
  name: Scalars['String']['output'];
  /** Organization's supported types, e.g. Primary, Escrow */
  types?: Maybe<Array<Scalars['String']['output']>>;
  /** Users which the Organization act as the Primary Node. */
  users: Users;
};


/** Organization's information. */
export type OrganizationAssetsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** Organization's information. */
export type OrganizationUsersArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};

export type OrganizationAsset = {
  __typename?: 'OrganizationAsset';
  asset: Asset;
  metadata: ProfileMetadata;
};

export type OrganizationOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<OrganizationOrderField>;
};

export enum OrganizationOrderField {
  /** organizations order by determined by Id field */
  Id = 'ID'
}

/** Results for Organization query. */
export type Organizations = {
  __typename?: 'Organizations';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Organization Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Organization>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type OutgoingMessage = {
  __typename?: 'OutgoingMessage';
  message?: Maybe<Message>;
  recipients: MessageRecipients;
};


export type OutgoingMessageRecipientsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export type OutgoingMessages = {
  __typename?: 'OutgoingMessages';
  nodes?: Maybe<Array<OutgoingMessage>>;
};

export type PageInfo = {
  __typename?: 'PageInfo';
  /** Cursor for the end of the current page */
  endCursor?: Maybe<Scalars['String']['output']>;
  /** Indicates if there are more items after the current page */
  hasNextPage: Scalars['Boolean']['output'];
  /** Total count of items */
  totalCount: Scalars['Int']['output'];
  /** Total count of items left to be presented */
  totalLeft: Scalars['Int']['output'];
};

export type PaginateInput = {
  /** Cursor field to return records after it */
  after?: InputMaybe<Scalars['String']['input']>;
  /** Number of records to return in response */
  limit?: InputMaybe<Scalars['Int']['input']>;
  /** Number of pages to skip to get new cursor */
  skip?: InputMaybe<Scalars['Int']['input']>;
};

export type PartialSettlement = {
  __typename?: 'PartialSettlement';
  unitValue: Scalars['String']['output'];
};

export type PendingDelivery = {
  __typename?: 'PendingDelivery';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PinningConfig = {
  __typename?: 'PinningConfig';
  /** pinning config unique id */
  id: Scalars['String']['output'];
  /** pinning service configuration data */
  nodes: Array<PinningConfigNodeEntry>;
};

export type PinningConfigNodeEntry = {
  __typename?: 'PinningConfigNodeEntry';
  addresses: Array<NodeAddress>;
  /** entry unique id */
  id: Scalars['String']['output'];
  token: Scalars['String']['output'];
};

export type PinningConfigs = {
  __typename?: 'PinningConfigs';
  /** pinning service configuration data */
  nodes?: Maybe<Array<PinningConfig>>;
};

export type PlanApproval = {
  __typename?: 'PlanApproval';
  orgId: Scalars['String']['output'];
  planId: Scalars['String']['output'];
  status: ApprovalStatus;
  statusInfo: PlanApprovalStatusInfo;
};

export type PlanApprovalStatusInfo = {
  __typename?: 'PlanApprovalStatusInfo';
  code: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

/** Results for Plan Approval query. */
export type PlanApprovals = {
  __typename?: 'PlanApprovals';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Plan Approval Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<PlanApproval>>;
};

/** Fields to subscribe on */
export enum PlanField {
  Status = 'Status'
}

export type PresignedBuyingIntentSignaturePolicy = {
  __typename?: 'PresignedBuyingIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedLoanIntentSignaturePolicy = {
  __typename?: 'PresignedLoanIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedPrivateOfferIntentSignaturePolicy = {
  __typename?: 'PresignedPrivateOfferIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedRedemptionIntentSignaturePolicy = {
  __typename?: 'PresignedRedemptionIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedRequestForTransferIntentSignaturePolicy = {
  __typename?: 'PresignedRequestForTransferIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PresignedSellingIntentSignaturePolicy = {
  __typename?: 'PresignedSellingIntentSignaturePolicy';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

export type PrimarySale = {
  __typename?: 'PrimarySale';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** Issuer id */
  issuerId: Scalars['String']['output'];
  sellingSettlementInstruction: SellingSettlementInstruction;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  /** Source account - issuer's account from which asset is sold */
  source: FinP2PAssetAccount;
};

export type PrivateOfferContractDetails = {
  __typename?: 'PrivateOfferContractDetails';
  asset: AssetOrder;
  settlement?: Maybe<AssetOrder>;
};

export type PrivateOfferIntent = {
  __typename?: 'PrivateOfferIntent';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the buyer */
  buyer?: Maybe<Scalars['String']['output']>;
  /** resource id of the seller */
  seller?: Maybe<Scalars['String']['output']>;
  sellingSettlementInstruction: SellingSettlementInstruction;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  signaturePolicy: PrivateOfferSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
  /** Source account - seller's account from which asset is sold */
  source: FinP2PAssetAccount;
};

export type PrivateOfferSignaturePolicy = ManualIntentSignaturePolicy | PresignedPrivateOfferIntentSignaturePolicy;

/** Profile interface. */
export type Profile = {
  /** Collection of certificates associated with the Profile. */
  certificates: Certificates;
  id: Scalars['String']['output'];
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  /** Organization id to which this profile is associated with. */
  organizationId: Scalars['String']['output'];
};


/** Profile interface. */
export type ProfileCertificatesArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};

/** Profile Metadata (ACL). */
export type ProfileMetadata = {
  __typename?: 'ProfileMetadata';
  acl?: Maybe<Array<Scalars['String']['output']>>;
  /** Shared resources data access given to which org */
  dataAccess?: Maybe<Array<DataAccess>>;
};

export type Proof = NoProof | SignatureProof;

export type ProofPolicy = NoProofPolicy | SignatureProofPolicy;

/** The query root of Ownera's GraphQL interface. */
export type Query = {
  __typename?: 'Query';
  approvalConfigs: ApprovalConfigs;
  /** Look up Asset Data, Optional provide Filter. */
  assetDatas: AssetDatas;
  /** Look up Assets, Optional provide Filters or Aggregates. */
  assets: Assets;
  /** Look up Certificates, Optional provide Filter or Aggregate. */
  certificates: Certificates;
  custodyProviders: CustodyProviders;
  /** Look up Data Provider bindings. */
  dataProviders: DataProviderBindings;
  /** Look up Data Rules that map identifiers to data providers. */
  dataRules: DataRules;
  /** Look up FinancialAssets aggregated by ISIN from data adapter data. Filter by isin to get a specific asset. */
  financialAssets: FinancialAssets;
  /** Look up Issuers, Optional provide Filter. */
  issuers: Issuers;
  ledgers: LedgerBindings;
  /** Look up Organizations, Optional provide Filter or Aggregate. */
  organizations: Organizations;
  pinningConfig?: Maybe<PinningConfigs>;
  /** Look up Execution Plans, Optional provide Filter. */
  plans: ExecutionsPlans;
  /** Look up a receipt by a Filter (mandatory). */
  receipts: Receipts;
  /** Look up Users, Optional provide Filter or Aggregate. */
  users: Users;
  /** Look up Workflows, Optional provide Filter. */
  workflows: Workflows;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryApprovalConfigsArgs = {
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryAssetDatasArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryAssetsArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<AssetOrderInput>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryCertificatesArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryCustodyProvidersArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryDataProvidersArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryDataRulesArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryFinancialAssetsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryIssuersArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryLedgersArgs = {
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryOrganizationsArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryPlansArgs = {
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<ExecutionPlanOrder>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryReceiptsArgs = {
  filter?: InputMaybe<Array<InputMaybe<Filter>>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryUsersArgs = {
  aggregate?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
  paginate?: InputMaybe<PaginateInput>;
};


/** The query root of Ownera's GraphQL interface. */
export type QueryWorkflowsArgs = {
  filter?: InputMaybe<Array<Filter>>;
  orderBy?: InputMaybe<WorkflowOrder>;
  paginate?: InputMaybe<PaginateInput>;
};

export type Receipt = {
  __typename?: 'Receipt';
  /** Destination owner resource ID */
  destination?: Maybe<Scalars['String']['output']>;
  /** Destination account of transaction */
  destinationAccount?: Maybe<LedgerAccountAsset>;
  id: Scalars['String']['output'];
  /** Operation id */
  operationId?: Maybe<Scalars['String']['output']>;
  /** Operation type */
  operationType?: Maybe<OperationType>;
  /** Ledger proof */
  proof?: Maybe<Proof>;
  /** Number of asset units with the transaction */
  quantity: Scalars['String']['output'];
  /** Source owner resource ID */
  source?: Maybe<Scalars['String']['output']>;
  /** Source account of transaction */
  sourceAccount?: Maybe<LedgerAccountAsset>;
  /** Receipt status */
  status: ReceiptStatus;
  /** Receipt timestamp */
  timestamp: Scalars['String']['output'];
  /** Trade details associated with the transaction */
  tradeDetails?: Maybe<TradeDetails>;
  /** Underlying transaction id */
  transactionId?: Maybe<Scalars['String']['output']>;
};

export type ReceiptOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<ReceiptOrderField>;
};

export enum ReceiptOrderField {
  /** receipt order by determined by Id field */
  Id = 'ID'
}

export type ReceiptState = {
  __typename?: 'ReceiptState';
  receipt: Receipt;
};

export enum ReceiptStatus {
  Invalid = 'Invalid',
  Unknown = 'Unknown',
  Valid = 'Valid'
}

/** Results for receipts query. */
export type Receipts = {
  __typename?: 'Receipts';
  /** Collection of Receipt Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<Receipt>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export type Recipient = Investor;

export type RedeemInstruction = {
  __typename?: 'RedeemInstruction';
  /** asset's redeem amount */
  amount: Scalars['String']['output'];
  /** source account information */
  source: LedgerAccountAsset;
};

export type RedemptionConditions = {
  __typename?: 'RedemptionConditions';
  redemptionDuration: Scalars['String']['output'];
};

export type RedemptionContractDetails = {
  __typename?: 'RedemptionContractDetails';
  asset: AssetOrder;
  settlement?: Maybe<AssetOrder>;
};

export type RedemptionIntent = {
  __typename?: 'RedemptionIntent';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** Intent conditions */
  conditions: RedemptionConditions;
  /** Destination account - where redeemed asset goes (to issuer) */
  destination?: Maybe<FinP2PAssetAccount>;
  /** Issuer id */
  issuerId: Scalars['String']['output'];
  /** Specify settlement accounts */
  redemptionSettlementInstruction?: Maybe<RedemptionSettlementInstruction>;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  signaturePolicy: RedemptionSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
};

export type RedemptionSettlementInstruction = {
  __typename?: 'RedemptionSettlementInstruction';
  /** Source accounts where payment comes from */
  accounts?: Maybe<Array<FinP2PAssetAccount>>;
};

export type RedemptionSignaturePolicy = ManualIntentSignaturePolicy | PresignedRedemptionIntentSignaturePolicy;

export type Reference = {
  __typename?: 'Reference';
  referenceId: Scalars['String']['output'];
  referenceType: Scalars['String']['output'];
  workflowId: Scalars['String']['output'];
};

export type ReleaseInstruction = {
  __typename?: 'ReleaseInstruction';
  /** asset's release amount */
  amount: Scalars['String']['output'];
  /** destination account information */
  destination: LedgerAccountAsset;
  /** source account information */
  source: LedgerAccountAsset;
};

export type RepaymentTerm = {
  __typename?: 'RepaymentTerm';
  annualPercentageRate?: Maybe<Scalars['String']['output']>;
  repaymentVolume: Scalars['String']['output'];
};

export type RequestForTransferAssetInstruction = RequestForTransferRequestInstruction | RequestForTransferSendInstruction;

export type RequestForTransferContractDetails = {
  __typename?: 'RequestForTransferContractDetails';
  asset: AssetOrder;
};

export type RequestForTransferIntent = {
  __typename?: 'RequestForTransferIntent';
  asset: RequestForTransferIntentAsset;
  /** resource id of the receiver */
  receiver?: Maybe<Scalars['String']['output']>;
  /** resource id of the sender */
  sender?: Maybe<Scalars['String']['output']>;
  signaturePolicy: RequestForTransferSignaturePolicy;
  signaturePolicyType: SignaturePolicyType;
};

export type RequestForTransferIntentAsset = {
  __typename?: 'RequestForTransferIntentAsset';
  assetInstruction: RequestForTransferAssetInstruction;
  assetTerm: AssetTerm;
};

export type RequestForTransferRequestInstruction = {
  __typename?: 'RequestForTransferRequestInstruction';
  /** Action type - always 'request' */
  action: Scalars['String']['output'];
  receiverAccount?: Maybe<FinP2PAssetAccount>;
};

export type RequestForTransferSendInstruction = {
  __typename?: 'RequestForTransferSendInstruction';
  /** Action type - always 'send' */
  action: Scalars['String']['output'];
  senderAccount?: Maybe<FinP2PAssetAccount>;
};

export type RequestForTransferSignaturePolicy = ManualIntentSignaturePolicy | PresignedRequestForTransferIntentSignaturePolicy;

export type RevertHoldInstruction = {
  __typename?: 'RevertHoldInstruction';
  /** destination account information */
  destination: LedgerAccountAsset;
  /** hold instruction sequence number to be reverted */
  holdInstructionSequence: Scalars['Int']['output'];
};

export type SellingContractDetails = {
  __typename?: 'SellingContractDetails';
  asset: AssetOrder;
  settlement?: Maybe<AssetOrder>;
};

export type SellingIntent = {
  __typename?: 'SellingIntent';
  /** Asset term specifies the asset information and amount of the intent */
  assetTerm: AssetTerm;
  /** resource id of the seller */
  seller?: Maybe<Scalars['String']['output']>;
  sellingSettlementInstruction: SellingSettlementInstruction;
  /** Settlement term */
  settlementTerm?: Maybe<SettlementTerm>;
  signaturePolicy: SellingSignaturePolicy;
  /** Signature policy type */
  signaturePolicyType: SignaturePolicyType;
  /** Source account - seller's account from which asset is sold */
  source: FinP2PAssetAccount;
};

export type SellingSettlementInstruction = {
  __typename?: 'SellingSettlementInstruction';
  /** Destination accounts where seller receives payment */
  accounts?: Maybe<Array<FinP2PAssetAccount>>;
};

export type SellingSignaturePolicy = ManualIntentSignaturePolicy | PresignedSellingIntentSignaturePolicy;

export type SequenceTransition = {
  __typename?: 'SequenceTransition';
  sequence: Scalars['Int']['output'];
};

export type SettlementInstruction = {
  __typename?: 'SettlementInstruction';
  details: SettlementInstructionTypeDetails;
};

export type SettlementInstructionTypeDetails = BuyingSettlementInstruction | SellingSettlementInstruction;

export type SettlementTerm = {
  __typename?: 'SettlementTerm';
  details: SettlementTermOptionType;
};

export type SettlementTermOptionType = FullSettlement | NoSettlement | PartialSettlement;

export type Signature = {
  __typename?: 'Signature';
  hashFunction: Scalars['String']['output'];
  signature: Scalars['String']['output'];
  template: Template;
  templateType: TemplateType;
};

export enum SignaturePolicyType {
  ManualPolicy = 'ManualPolicy',
  PresignedPolicy = 'PresignedPolicy'
}

export type SignatureProof = {
  __typename?: 'SignatureProof';
  signature: Signature;
};

export type SignatureProofPolicy = {
  __typename?: 'SignatureProofPolicy';
  signatureTemplate: SignatureTemplate;
  verifyingKey: Scalars['String']['output'];
};

export enum SignatureTemplate {
  Eip712 = 'EIP712',
  HashList = 'HashList',
  Unknown = 'Unknown'
}

export enum SortOrder {
  Asc = 'ASC',
  Desc = 'DESC'
}

export type StatusTransition = {
  __typename?: 'StatusTransition';
  status: ExecutionPlanStatus;
};

export type Subscription = {
  __typename?: 'Subscription';
  assetDataChanged: AssetDataItem;
  planAdded: ExecutionPlan;
  plansChangedBy: ExecutionPlan;
  receiptAdded: Receipt;
  userHoldingAdded: User;
  userHoldingChanged: User;
};


export type SubscriptionAssetDataChangedArgs = {
  dataTypes?: InputMaybe<Array<DataType>>;
  identifierType?: InputMaybe<AssetDataIdentifierType>;
  identifierValue?: InputMaybe<Scalars['String']['input']>;
};


export type SubscriptionPlansChangedByArgs = {
  fieldNames: Array<PlanField>;
};


export type SubscriptionUserHoldingChangedArgs = {
  fieldNames: Array<HoldingFields>;
};

export type SuccessState = {
  __typename?: 'SuccessState';
  output?: Maybe<SuccessStateOutput>;
};

export type SuccessStateOutput = Receipt;

export type Template = Eip712Template | HashlistTemplate;

/** Represents an Asset token balance information. */
export type TokenBalance = {
  __typename?: 'TokenBalance';
  assetId: Scalars['String']['output'];
  quantity: Scalars['String']['output'];
  transactionsDetails?: Maybe<Array<TransactionDetails>>;
  userId: Scalars['String']['output'];
};

/** Results for tokens query. */
export type TokensBalances = {
  __typename?: 'TokensBalances';
  /** Collection of Aggregate Results, if an Aggregate input was provided. */
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of Token Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<TokenBalance>>;
};

export type TradeDetails = {
  __typename?: 'TradeDetails';
  /** Details of ExecutionPlan associated with the transaction */
  executionContext?: Maybe<ExecutionContext>;
  /** Intent  associated with the transaction */
  intent?: Maybe<Intent>;
};

export type TransactionDetails = {
  __typename?: 'TransactionDetails';
  index: Scalars['Int']['output'];
  quantity: Scalars['String']['output'];
  transactionId: Scalars['String']['output'];
};

export type TransferContractDetails = {
  __typename?: 'TransferContractDetails';
  asset: AssetOrder;
};

export type TransferInstruction = {
  __typename?: 'TransferInstruction';
  /** asset's transfer amount */
  amount: Scalars['String']['output'];
  /** destination account information */
  destination: LedgerAccountAsset;
  /** source account information */
  source: LedgerAccountAsset;
};

export type Transition = SequenceTransition | StatusTransition;

export type UnknownState = {
  __typename?: 'UnknownState';
  _ignore?: Maybe<Scalars['Boolean']['output']>;
};

/** Represents an User in the network. */
export type User = Profile & {
  __typename?: 'User';
  accounts?: Maybe<Array<FinP2PAccount>>;
  /** Collection of certificates associated with the Profile. */
  certificates: Certificates;
  /** Data access permissions this resource has received from other organizations */
  dataAccessReceived?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** finIds keys associated with this investor */
  finIds?: Maybe<Array<Scalars['String']['output']>>;
  holdings: Holdings;
  id: Scalars['String']['output'];
  /** User's associated messages */
  inbox: Messages;
  /** Profile metadata, contains ACL information of the profile. */
  metadata: ProfileMetadata;
  name: Scalars['String']['output'];
  /** Organization id to whom this profile is associated with. */
  organizationId: Scalars['String']['output'];
  /** user resource version */
  version: Scalars['String']['output'];
};


/** Represents an User in the network. */
export type UserAccountsArgs = {
  filter?: InputMaybe<Array<Filter>>;
};


/** Represents an User in the network. */
export type UserCertificatesArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};


/** Represents an User in the network. */
export type UserHoldingsArgs = {
  aggregates?: InputMaybe<Array<Aggregate>>;
  filter?: InputMaybe<Array<Filter>>;
};


/** Represents an User in the network. */
export type UserInboxArgs = {
  filter?: InputMaybe<Array<Filter>>;
};

export type UserOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<UserOrderField>;
};

export enum UserOrderField {
  /** users order by determined by Id field */
  Id = 'ID'
}

/** Results for asset query. */
export type Users = {
  __typename?: 'Users';
  aggregate?: Maybe<Array<AggregateResult>>;
  /** Collection of User Objects, conforms to the Filter input if provided. */
  nodes?: Maybe<Array<User>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

/** Regulation Verifier */
export type Verifier = {
  __typename?: 'Verifier';
  /** Verifier ID */
  id?: Maybe<Scalars['String']['output']>;
  /** Verifier Name */
  name?: Maybe<Scalars['String']['output']>;
  /** Provider type: REG_APP_STORE, OTHER */
  provider?: Maybe<Scalars['String']['output']>;
};

/** Wallet account for blockchain wallets */
export type WalletAccount = {
  __typename?: 'WalletAccount';
  /** Wallet address */
  address: Scalars['String']['output'];
  /** Type of wallet (e.g., ethereum) */
  type: Scalars['String']['output'];
};

export type Workflow = {
  __typename?: 'Workflow';
  /** Admin operations history and metadata */
  adminMetadata?: Maybe<WorkflowAdminMetadata>;
  /** Available admin actions for this workflow */
  availableActions: Array<WorkflowAdminAction>;
  /** Workflow creation timestamp */
  creationTimestamp: Scalars['Int']['output'];
  /** the time workflow expires */
  expires: Scalars['Int']['output'];
  /** Health status and admin information for the workflow */
  health?: Maybe<WorkflowHealth>;
  /** Id of the workflow */
  id: Scalars['String']['output'];
  /** metadata of the workflow */
  metadata: WorkflowMetadata;
  /** Name of the workflow */
  name: Scalars['String']['output'];
  /** list of reference information of the workflow */
  references: Array<Reference>;
  /** Current status of the workflow */
  status: Scalars['String']['output'];
  /** Current transition id of the workflow */
  transitionId: Scalars['String']['output'];
  /** version of the workflow */
  version: Scalars['Int']['output'];
};

/** Available admin actions for workflows */
export enum WorkflowAdminAction {
  Cancel = 'CANCEL',
  Reset = 'RESET',
  Resume = 'RESUME',
  Retry = 'RETRY'
}

/** Admin operations metadata and history */
export type WorkflowAdminMetadata = {
  __typename?: 'WorkflowAdminMetadata';
  /** Last admin action performed */
  lastAction?: Maybe<WorkflowAdminAction>;
  /** User who performed last action */
  lastActionBy?: Maybe<Scalars['String']['output']>;
  /** Timestamp of last admin action */
  lastActionTimestamp?: Maybe<Scalars['Int']['output']>;
  /** Total number of admin actions performed */
  totalActions: Scalars['Int']['output'];
};

/** Health status of a workflow */
export type WorkflowHealth = {
  __typename?: 'WorkflowHealth';
  /** List of health issues detected */
  issues: Array<Scalars['String']['output']>;
  /** Timestamp when health was last assessed */
  lastAssessed: Scalars['Int']['output'];
  /** Additional health metadata */
  metadata?: Maybe<WorkflowHealthMetadata>;
  /** Current health status */
  status: WorkflowHealthStatus;
  /** health stuck since timestamp */
  stuckSince: Scalars['Int']['output'];
};

/** Additional health assessment metadata */
export type WorkflowHealthMetadata = {
  __typename?: 'WorkflowHealthMetadata';
  /** Workflow age in seconds */
  age?: Maybe<Scalars['Int']['output']>;
  /** Number of retry attempts */
  retryCount?: Maybe<Scalars['Int']['output']>;
  /** Time since last state transition */
  timeSinceLastTransition?: Maybe<Scalars['Int']['output']>;
};

/** Health status enumeration */
export enum WorkflowHealthStatus {
  Healthy = 'HEALTHY',
  Stale = 'STALE',
  Stuck = 'STUCK',
  Unhealthy = 'UNHEALTHY'
}

export type WorkflowMetadata = {
  __typename?: 'WorkflowMetadata';
  correlationIds?: Maybe<Array<Scalars['String']['output']>>;
  currentStateRetry: Scalars['Int']['output'];
  retry: Scalars['Int']['output'];
  traceId: Scalars['String']['output'];
  /** TTL of the workflow */
  ttl: Scalars['Int']['output'];
};

export type WorkflowOrder = {
  direction?: InputMaybe<SortOrder>;
  field?: InputMaybe<WorkflowOrderField>;
};

export enum WorkflowOrderField {
  CorrelationId = 'CORRELATION_ID',
  HealthStatus = 'HEALTH_STATUS',
  /** workflow order */
  Name = 'NAME',
  ReferenceId = 'REFERENCE_ID',
  Status = 'STATUS'
}

export type Workflows = {
  __typename?: 'Workflows';
  nodes?: Maybe<Array<Workflow>>;
  /** Keeps pagination info in-case limit input wes provided */
  pageInfo?: Maybe<PageInfo>;
};

export enum TemplateType {
  Eip712Template = 'EIP712Template',
  HashListTemplate = 'HashListTemplate'
}

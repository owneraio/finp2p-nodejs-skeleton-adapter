import { EIP712Template } from './eip712';

export type AssetType = 'finp2p' | 'fiat' | 'cryptocurrency';

export type Asset = {
  assetId: string
  assetType: AssetType
  ledgerIdentifier: LedgerAssetIdentifier
};

export type LedgerAssetIdentifier = Caip19LedgerAssetIdentifier;

export type Caip19LedgerAssetIdentifier = {
  assetIdentifierType: 'CAIP-19';
  network?: string;
  tokenId: string;
  standard?: string;
};

// Per API spec, deposit assets are limited to 'finp2p' or 'custom' variants (no ledgerIdentifier)
export type DepositAsset = {
  assetId: string
  assetType: 'finp2p'
} | {
  assetType: 'custom'
};


export type FinIdAccount = {
  finId: string;
  orgId: string;
  custodianOrgId: string;
};

export type Source = {
  finId: string
  account?: LedgerAccount
};

export type Destination = {
  finId: string
  account?: LedgerAccount
};

/** Note a custodialAccount has no address, so switch on `type`. */
export type LedgerAccount = {
  type: 'walletAccount';
  address: string;
} | {
  type: 'caip10Account';
  network: string;
  address: string;
} | {
  type: 'custodialAccount';
  provider: string;
  vaultAccountId: string;
  assetId?: string;
};


export type ExecutionContext = {
  planId: string
  sequence: number
  counterpartyAssetId?: string
};

/**
 * One leg of an atomic swap. Perspective-relative on the adapter API:
 * the `asset` leg is always the one this adapter executes, the
 * `settlement` leg is the binding counter-leg its party receives.
 * `signature` is the leg owner's signature over the FULL swap terms
 * (both legs); present on the counter-leg only in single-call execution.
 */
export type SwapLeg = {
  asset: Asset
  source: Source
  destination: Destination
  quantity: string
  signature?: Signature
};

export type ErrorDetails = {
  code: number;
  message: string;
};


export type Balance = {
  current: string
  available: string
  held: string
};


export type TokenIdentifier = {
  tokenId: string
  network?: string
  standard?: string
};


export type AssetBind = {
  tokenIdentifier: TokenIdentifier
};

export type AssetDenominationType = 'finp2p' | 'fiat' | 'cryptocurrency';

export type AssetDenomination = {
  type: AssetDenominationType
  code: string
};

export type AdditionalContractDetails = {
  finP2POperatorContractAddress: string | undefined
  allowanceRequired: boolean | undefined
};

export type LedgerReference = {
  type: 'ledgerReference';
  network: string;
  address: string;
  tokenStandard: string | undefined;
  additionalContractDetails: AdditionalContractDetails | undefined
};

export type IntentType =
  'primarySale'
  | 'buyingIntent'
  | 'sellingIntent'
  | 'loanIntent'
  | 'redemptionIntent'
  | 'privateOfferIntent'
  | 'requestForTransferIntent'
  | 'moveIntent';



export type Leg = {
  asset: Asset;
  amount: string;
  source?: FinIdAccount;
  destination?: FinIdAccount;
};

export type PlanContract = {
  asset: Leg;
  payment?: Leg;
  investors: PlanInvestor[];
};

export type PlanInvestorRole = 'buyer' | 'seller' | 'lender' | 'borrower' | 'issuer';

export type PlanInvestor = {
  profileId: string;
  role: PlanInvestorRole;
  signature: Signature | undefined
};

export type HoldInstruction = {
  type: 'hold';
  asset: Asset;
  source: FinIdAccount;
  destination?: FinIdAccount;
  amount: string;
};

export type ReleaseInstruction = {
  type: 'release';
  /** Source-side binding of the asset (the adapter's local resource when outbound). */
  asset: Asset;
  /**
   * Destination-side binding of the asset (the adapter's local resource when
   * inbound). In cross-org DvP each side binds the same on-chain token as its
   * own FinP2P resource, so this can differ from `asset`. Consumers that act
   * on the destination side (e.g. InboundTransferHook) must read this field.
   */
  destinationAsset: Asset;
  source: FinIdAccount;
  destination: FinIdAccount;
  amount: string;
};

export type IssueInstruction = {
  type: 'issue';
  asset: Asset;
  destination: FinIdAccount;
  amount: string;
};

export type TransferInstruction = {
  type: 'transfer';
  /** Source-side binding of the asset (the adapter's local resource when outbound). */
  asset: Asset;
  /**
   * Destination-side binding of the asset (the adapter's local resource when
   * inbound). In cross-org DvP each side binds the same on-chain token as its
   * own FinP2P resource, so this can differ from `asset`. Consumers that act
   * on the destination side (e.g. InboundTransferHook) must read this field.
   */
  destinationAsset: Asset;
  source: FinIdAccount;
  destination: FinIdAccount;
  amount: string;
};

export type AwaitInstruction = {
  type: 'await';
  waitUntil: number; // Format: uint64
};

export type RevertHoldInstruction = {
  type: 'revertHoldInstruction';
  source?: FinIdAccount;
  destination: FinIdAccount;
};

export type RedemptionInstruction = {
  type: 'redeem';
  asset: Asset;
  source: FinIdAccount;
  destination?: FinIdAccount;
  amount: string;
};

export type ExecutionPlanOperation = HoldInstruction | ReleaseInstruction | IssueInstruction | TransferInstruction | AwaitInstruction | RevertHoldInstruction | RedemptionInstruction;

export type ExecutionInstruction = {
  sequence: number;
  organizations: string[];
  operation: ExecutionPlanOperation;
  timeout?: number;
};

export type ExecutionPlan = {
  id: string;
  intentType?: IntentType;
  contract: PlanContract;
  instructions: ExecutionInstruction[];
};

// -----------


export type HashField = {
  name: string
  type: 'string' | 'int' | 'bytes'
  value: string
};

export type HashGroup = {
  hash: string
  fields: HashField[]
};

export type HashListTemplate = {
  type: 'hashList'
  hash: string
  hashGroups: HashGroup[]
};

// -------------------------------------------------------------------


export type SignatureTemplate = HashListTemplate | EIP712Template;

export type Signature = {
  signature: string;
  template: SignatureTemplate;
  hashFunc: 'unspecified' | 'sha3_256' | 'sha3-256' | 'blake2b' | 'keccak_256' | 'keccak-256';
};

// ------------------------------------------------------------------

export type OperationResponseStrategy = 'polling' | 'callback';

export type OperationMetadata = {
  responseStrategy: OperationResponseStrategy
};


// -------------------------------------------------------------------

export type ApprovedPlan = {
  operation: 'approval',
  type: 'approved';
};

export type RejectedPlan = {
  operation: 'approval',
  type: 'rejected';
  error: ErrorDetails
};

export type PendingPlan = {
  operation: 'approval',
  type: 'pending';
  correlationId: string;
  metadata: OperationMetadata | undefined
};

export type PlanApprovalStatus = ApprovedPlan | RejectedPlan | PendingPlan;

export type PlanProposalCancel = { proposalType: 'cancel' };
export type PlanProposalReset = { proposalType: 'reset'; proposedSequence: number };
export type PlanProposalInstruction = { proposalType: 'instruction'; instructionSequence: number };
export type PlanProposal = PlanProposalCancel | PlanProposalReset | PlanProposalInstruction;


export const approvedPlan = (): PlanApprovalStatus => ({
  operation: 'approval',
  type: 'approved',
});

export const rejectedPlan = (code: number, message: string): PlanApprovalStatus => ({
  operation: 'approval',
  type: 'rejected',
  error: { code, message },
});

export const pendingPlan = (correlationId: string, metadata: OperationMetadata | undefined): PlanApprovalStatus => ({
  operation: 'approval',
  type: 'pending',
  correlationId,
  metadata,
});

// -------------------------------------------------------------------

export type AssetCreationResult = {
  ledgerIdentifier: LedgerAssetIdentifier;
  reference: LedgerReference | undefined;
};

export type SuccessfulAssetCreation = {
  operation: 'createAsset',
  type: 'success';
  result: AssetCreationResult;
};

export type FailedAssetCreation = {
  operation: 'createAsset',
  type: 'failure';
  error: ErrorDetails
};

export type PendingAssetCreation = {
  operation: 'createAsset',
  type: 'pending';
  correlationId: string;
  metadata: OperationMetadata | undefined
};

export type AssetCreationStatus = SuccessfulAssetCreation | FailedAssetCreation | PendingAssetCreation;

export const successfulAssetCreation = (result: AssetCreationResult): AssetCreationStatus => ({
  operation: 'createAsset',
  type: 'success',
  result,
});

export const failedAssetCreation = (code: number, message: string): AssetCreationStatus => ({
  operation: 'createAsset',
  type: 'failure',
  error: { code, message },
});

export const pendingAssetCreation = (correlationId: string, metadata: OperationMetadata | undefined): AssetCreationStatus => ({
  operation: 'createAsset',
  type: 'pending',
  correlationId,
  metadata,
});

// -------------------------------------------------------------------

export type SuccessReceiptStatus = {
  operation: 'receipt',
  type: 'success';
  receipt: Receipt;
};

export type FailedReceiptStatus = {
  operation: 'receipt',
  type: 'failure';
  error: ErrorDetails
};

export type PendingReceiptStatus = {
  operation: 'receipt',
  type: 'pending';
  correlationId: string;
  metadata: OperationMetadata | undefined
};

export type ReceiptOperation = PendingReceiptStatus | FailedReceiptStatus | SuccessReceiptStatus;


export const successfulReceiptOperation = (receipt: Receipt): ReceiptOperation => ({
  operation: 'receipt',
  type: 'success',
  receipt,
});

export const failedReceiptOperation = (code: number, message: string): ReceiptOperation => ({
  operation: 'receipt',
  type: 'failure',
  error: { code, message },
});

export const pendingReceiptOperation = (correlationId: string, metadata: OperationMetadata | undefined): ReceiptOperation => ({
  operation: 'receipt',
  type: 'pending',
  correlationId,
  metadata,
});

// -------------------------------------------------------------------

export type SuccessSwapStatus = {
  operation: 'swap',
  type: 'success';
  asset: Receipt;
};

export type FailedSwapStatus = {
  operation: 'swap',
  type: 'failure';
  error: ErrorDetails
};

export type PendingSwapStatus = {
  operation: 'swap',
  type: 'pending';
  correlationId: string;
  metadata: OperationMetadata | undefined
};

export type SwapOperation = PendingSwapStatus | FailedSwapStatus | SuccessSwapStatus;

export const successfulSwapOperation = (asset: Receipt): SwapOperation => ({
  operation: 'swap',
  type: 'success',
  asset,
});

export const failedSwapOperation = (code: number, message: string): SwapOperation => ({
  operation: 'swap',
  type: 'failure',
  error: { code, message },
});

export const pendingSwapOperation = (correlationId: string, metadata: OperationMetadata | undefined): SwapOperation => ({
  operation: 'swap',
  type: 'pending',
  correlationId,
  metadata,
});

// -------------------------------------------------------------------

export type SuccessSwapSingleStatus = {
  operation: 'swapSingle',
  type: 'success';
  asset: Receipt;
  settlement: Receipt;
};

export type FailedSwapSingleStatus = {
  operation: 'swapSingle',
  type: 'failure';
  error: ErrorDetails
};

export type PendingSwapSingleStatus = {
  operation: 'swapSingle',
  type: 'pending';
  correlationId: string;
  metadata: OperationMetadata | undefined
};

export type SwapSingleOperation = PendingSwapSingleStatus | FailedSwapSingleStatus | SuccessSwapSingleStatus;

export const successfulSwapSingleOperation = (asset: Receipt, settlement: Receipt): SwapSingleOperation => ({
  operation: 'swapSingle',
  type: 'success',
  asset,
  settlement,
});

export const failedSwapSingleOperation = (code: number, message: string): SwapSingleOperation => ({
  operation: 'swapSingle',
  type: 'failure',
  error: { code, message },
});

export const pendingSwapSingleOperation = (correlationId: string, metadata: OperationMetadata | undefined): SwapSingleOperation => ({
  operation: 'swapSingle',
  type: 'pending',
  correlationId,
  metadata,
});

// -------------------------------------------------------------------


export type IbanAccountDetails = {
  type: 'iban'
  iban: string;
};

export type SwiftAccountDetails = {
  type: 'swift';
  swiftCode: string;
  accountNumber: string;
};

export type SortCodeDetails = {
  type: 'sortCode';
  code: string;
  accountNumber: string;
};

export type WireDetails = IbanAccountDetails | SwiftAccountDetails | SortCodeDetails;

export type WireTransfer = {
  type: 'wireTransfer'
  accountHolderName: string
  bankName: string
  wireDetails: WireDetails
  line1?: string
  city?: string
  postalCode?: string
  country?: string
};

export type WireTransferUsa = {
  type: 'wireTransferUSA';
  accountNumber: string;
  routingNumber: string;
  line1?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  state?: string;
};

export type CryptoTransfer = {
  type: 'cryptoTransfer';
  network: string;
  contractAddress: string;
  walletAddress: string;
};

export type PaymentInstruction = {
  type: 'paymentInstructions';
  instruction: string;
};

export type PaymentMethodInstruction = WireTransfer | WireTransferUsa | CryptoTransfer | PaymentInstruction;

export type PaymentMethod = {
  description: string
  currency: string
  methodInstruction: PaymentMethodInstruction
};

export type DepositInstruction = {
  asset: DepositAsset
  account: Destination
  description: string
  paymentOptions: PaymentMethod[]
  operationId: string | undefined
  details: any | undefined
};

export type DepositOperation = SuccessfulDepositOperation | FailedDepositOperation | PendingDepositOperation;

export type SuccessfulDepositOperation = {
  operation: 'deposit',
  type: 'success';
  instruction: DepositInstruction
};

export type FailedDepositOperation = {
  operation: 'deposit',
  type: 'failure';
  error: ErrorDetails
};

export type PendingDepositOperation = {
  operation: 'deposit',
  type: 'pending';
  correlationId: string;
  metadata: OperationMetadata | undefined
};

export const successfulDepositOperation = (instruction: DepositInstruction): DepositOperation => ({
  operation: 'deposit',
  type: 'success',
  instruction,
});

export const failedDepositOperation = (code: number, message: string): DepositOperation => ({
  operation: 'deposit',
  type: 'failure',
  error: { code, message },
});

export const pendingDepositOperation = (correlationId: string, metadata: OperationMetadata | undefined): DepositOperation => ({
  operation: 'deposit',
  type: 'pending',
  correlationId,
  metadata,
});

// -------------------------------------------------------------------

export type NetworkAccount = LedgerAccount | {
  type: 'none';
};

/** Canonical account record returned on onboarding completion. `id` is the LA-assigned
 *  account identifier, later used by `DELETE /accounts/{accountId}`. */
export type NetworkAccountRecord = {
  id: string;
  account: NetworkAccount;
};

export type BindInfo = {
  account: NetworkAccount;
  /** Raw hex proof-of-ownership hint supplied by the caller, as the router sends
   *  it: a bare signature with no template and no hash function, since only the
   *  challenge bytes are signed. Not verified in this trust model — kept so
   *  implementations can log it or opportunistically check it themselves.
   *  Absent only when the caller sent no signature at all. */
  ownershipSignature?: string;
};

export type PendingAccountOperation = {
  operation: 'account',
  type: 'pending';
  correlationId: string;
  metadata: OperationMetadata | undefined;
};

export type SuccessfulAccountOperation = {
  operation: 'account',
  type: 'success';
  correlationId: string;
  record: NetworkAccountRecord;
};

export type FailedAccountOperation = {
  operation: 'account',
  type: 'failure';
  correlationId: string;
  error: ErrorDetails;
};

export type AccountOperation = PendingAccountOperation | SuccessfulAccountOperation | FailedAccountOperation;

export const pendingAccountOperation = (correlationId: string, metadata: OperationMetadata | undefined): AccountOperation => ({
  operation: 'account',
  type: 'pending',
  correlationId,
  metadata,
});

export const successfulAccountOperation = (correlationId: string, record: NetworkAccountRecord): AccountOperation => ({
  operation: 'account',
  type: 'success',
  correlationId,
  record,
});

export const failedAccountOperation = (correlationId: string, code: number, message: string): AccountOperation => ({
  operation: 'account',
  type: 'failure',
  correlationId,
  error: { code, message },
});

// -------------------------------------------------------------------

export type OperationStatus = ReceiptOperation | AssetCreationStatus | DepositOperation | PlanApprovalStatus | AccountOperation | SwapOperation | SwapSingleOperation;


// -------------------------------------------------------------------


export type NoProofPolicy = {
  type: 'no-proof'
};

export type SignatureProofPolicy = {
  type: 'signature-proof';
  hashFunc: 'sha3-256' | 'keccak-256';
  template: SignatureTemplate
  signature: string
};

export type ProofPolicy = NoProofPolicy | SignatureProofPolicy;

export type TransactionDetails = {
  transactionId: string
  operationId: string | undefined
};

export type TradeDetails = {
  executionContext: ExecutionContext | undefined
};

export type OperationType = 'transfer' | 'redeem' | 'hold' | 'release' | 'issue' | 'swap' | 'swapSingle';

export type Receipt = {
  id: string,
  asset: Asset
  source: Source | undefined,
  destination: Destination | undefined,
  quantity: string,
  transactionDetails: TransactionDetails
  tradeDetails: TradeDetails,
  operationType: OperationType,
  proof: ProofPolicy | undefined,
  timestamp: number
};

// -------------------------------------------------------------------

export type AccountMapping = {
  finId: string;
  fields: Record<string, string>;
};


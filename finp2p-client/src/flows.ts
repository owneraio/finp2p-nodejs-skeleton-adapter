/**
 * High-level FinP2P flow methods: intent creation, execution, and asset management.
 *
 * These compose the low-level FinAPIClient methods (createIntent, executeIntent, etc.)
 * with structured parameter objects and automatic async operation polling.
 */
import type { FinP2PClient } from './client';
import type { FinAPIComponents } from './finapi';
import { extractOrgId, hexNonce, finIdAccount } from './finapi/utils';

const OP_TIMEOUT = 100_000;

/**
 * Reference to a FinP2P asset as required by v0.28 intent payloads:
 * { id, ledgerIdentifier } — no `resourceId`/`code`/`type` variants.
 */
export type Finp2pAsset = {
  id: string;
  ledgerIdentifier: {
    assetIdentifierType: 'CAIP-19';
    network: string;
    tokenId: string;
    standard: string;
  };
};

/** Build the asset payload embedded in intent instructions (matches schema `finp2pAsset`). */
function finp2pAsset(ref: Finp2pAsset) {
  return {
    id: ref.id,
    ledgerIdentifier: ref.ledgerIdentifier,
  };
}

function intentWindow(): { start: number; end: number } {
  const now = Math.floor(Date.now() / 1000);
  return { start: now, end: now + 3600 * 4 };
}

function requireSettlementAsset(value: Finp2pAsset | undefined, side: string): Finp2pAsset {
  if (!value) throw new Error(`settlementAsset (or ${side}SettlementAsset override) is required`);
  return value;
}

function requireSettlementOrgId(value: string | undefined, side: string): string {
  if (!value) throw new Error(`settlementOrgId (or ${side}SettlementOrgId override) is required`);
  return value;
}

type FetchResult = { data?: unknown; error?: unknown };

/**
 * Wrap an openapi-fetch call promise and resolve to its success body, polling
 * through any async (cid-bearing) `operationBase` response so the synchronous
 * and deferred paths produce the same shape. Throws on `.error` or empty data.
 *
 * `T` is the **post-completion** body shape — pass it explicitly because
 * openapi-fetch's `data` type unions the 200 success shape with the 202
 * `operationBase`, and we want the caller to commit to the success
 * variant. For example:
 *
 *   const res = await unwrapOperation<{ id: string }>(client, client.createAsset(...));
 *   const id = res.id;
 */
async function unwrapOperation<T>(
  client: FinP2PClient,
  call: Promise<FetchResult>,
): Promise<T> {
  const result = await call;
  if (result.error) {
    throw new Error(JSON.stringify(result.error));
  }
  const data = result.data;
  if (data == null) {
    throw new Error('empty response');
  }
  const op = data as { cid?: string; id?: string };
  if (op.cid && !op.id) {
    // Async: the API returned an `operationBase` (cid only). Poll until the
    // operation completes and unwrap the nested `.response` so the polled
    // path produces the same shape as the synchronous path.
    const completed = await client.waitForOperationCompletion(op.cid, OP_TIMEOUT);
    return ((completed as { response?: unknown }).response ?? completed) as T;
  }
  return data as T;
}

// ── Owner / Profile ──

export interface Investor {
  id: string;
  finId: string;
  orgId: string;
  custodianOrgId: string;
}

export async function createOwner(
  client: FinP2PClient,
  orgId: string,
  custodianOrgId: string,
): Promise<Investor> {
  const owner = await unwrapOperation<{ id: string }>(client, client.createOwner());
  const account = await unwrapOperation<{ finId: string }>(
    client,
    client.createOwnerAccount(owner.id, { orgId: custodianOrgId }),
  );
  return { id: owner.id, finId: account.finId, orgId, custodianOrgId };
}

// ── Asset creation ──

export interface CreateAssetParams {
  name: string;
  /** Asset classification (Equity, Debt, Cryptocurrency, Fiat, etc.) */
  type: 'Equity' | 'Debt' | 'Loans' | 'Fund' | 'RealEstate' | 'Commodity' | 'Fiat' | 'Cryptocurrency' | 'TokenizedCash' | 'DigitalNatives' | 'Basket' | 'Other';
  issuerId?: string;
  symbol?: string;
  denominationCode: string;
  /** How the asset is denominated for settlement purposes. Defaults to 'finp2p'. */
  denominationType?: 'finp2p' | 'fiat' | 'cryptocurrency';
  intentTypes?: Array<'primarySale' | 'buyingIntent' | 'sellingIntent' | 'loanIntent' | 'redemptionIntent' | 'privateOfferIntent' | 'requestForTransferIntent'>;
  /** Logical ledger name, must match the ledgerName registered via /ledger/bind */
  ledger: string;
  /** CAIP-2 chain id, e.g. 'eip155:11155111' (Sepolia) */
  network: string;
  /** Token identifier on the ledger (e.g. ERC-20 contract address) */
  tokenId: string;
  /** Token standard, e.g. 'erc20' */
  standard: string;
  assetPolicies?: FinAPIComponents['schemas']['assetPolicies'];
  /** @deprecated use `metadata` instead */
  config?: string;
  metadata?: any;
  /** Regulation verifiers to execute when validating a transaction on this asset. */
  verifiers?: FinAPIComponents['schemas']['assetVerifier'][];
  /** Optional financial asset identifier (ISIN/ISO4217/NONE) */
  financialIdentifier?:
  | { assetIdentifierType: 'ISIN'; assetIdentifierValue: string }
  | { assetIdentifierType: 'ISO4217'; assetIdentifierValue: string }
  | { assetIdentifierType: 'NONE' };
  /** Org's on-chain settlement wallet for this asset ({ type, address }). */
  orgSettlementAccount?: FinAPIComponents['schemas']['walletAccount'];
  /** Whether to fall back to a default policy when none matches. Defaults to true server-side. */
  allowPolicyDefaultFallback?: boolean;
  /** Decimal places the asset supports (0–18). */
  decimalPlaces?: number;
  /** Auto-share the asset profile with all known organizations. Defaults to false server-side. */
  autoShare?: boolean;
}

/**
 * Sparse update over an existing asset profile. Only the fields you set are
 * sent; omitted fields are not changed. Pass `null` for nullable fields
 * (metadata, config, verifiers, allowPolicyDefaultFallback) to clear them.
 *
 * Fields that are **immutable** post-creation and therefore not on this
 * shape: type, issuerId, denomination, ledgerAssetBinding,
 * financialIdentifier, intentTypes, orgSettlementAccount, decimalPlaces.
 * Intent allow-list changes go through dedicated routes under
 * `/profiles/asset/{id}/intent[/...]`.
 */
export interface UpdateAssetParams {
  name?: string;
  symbol?: string;
  assetPolicies?: FinAPIComponents['schemas']['assetPoliciesOpt'];
  metadata?: any | null;
  /** @deprecated use `metadata` instead */
  config?: string | null;
  verifiers?: FinAPIComponents['schemas']['assetVerifier'][] | null;
  allowPolicyDefaultFallback?: boolean | null;
  autoShare?: boolean | null;
}

export async function updateAsset(client: FinP2PClient, id: string, params: UpdateAssetParams): Promise<void> {
  await unwrapOperation<unknown>(client, client.updateAsset(id, params));
}

export async function createAsset(client: FinP2PClient, params: CreateAssetParams): Promise<string> {
  const res = await unwrapOperation<{ id: string }>(client, client.createAsset({
    name: params.name,
    type: params.type,
    issuerId: params.issuerId,
    symbol: params.symbol,
    denomination: { type: params.denominationType ?? 'finp2p', code: params.denominationCode },
    intentTypes: params.intentTypes,
    ledgerAssetBinding: {
      ledger: params.ledger,
      bind: {
        assetIdentifierType: 'CAIP-19' as const,
        network: params.network,
        tokenId: params.tokenId,
        standard: params.standard,
      },
    },
    assetPolicies: params.assetPolicies,
    config: params.config,
    metadata: params.metadata,
    verifiers: params.verifiers,
    financialIdentifier: params.financialIdentifier,
    orgSettlementAccount: params.orgSettlementAccount,
    allowPolicyDefaultFallback: params.allowPolicyDefaultFallback,
    decimalPlaces: params.decimalPlaces,
    autoShare: params.autoShare,
  }));
  if (!res.id) throw new Error('Failed to create asset');
  return res.id;
}

// ── Intent creation ──

export interface PrimarySaleParams {
  asset: Finp2pAsset;
  settlementAsset: Finp2pAsset;
  issuanceAmount: number;
  issuerId: string;
  issuerFinId: string;
  price: number;
  settlementOrgId: string;
  custodianOrgId: string;
}

export async function createPrimarySale(client: FinP2PClient, params: PrimarySaleParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const { start, end } = intentWindow();

  const res = await unwrapOperation<{ id: string }>(client, client.createIntent(params.asset.id, {
    start, end,
    intent: {
      type: 'primarySale',
      issuer: params.issuerId,
      asset: {
        assetTerm: { amount: String(params.issuanceAmount) },
        assetInstruction: {
          sourceAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.issuerFinId, assetOrgId, params.custodianOrgId),
          },
        },
      },
      settlement: [{
        settlementTerm: { type: 'partialSettlement', unitValue: params.price.toFixed(2) },
        settlementInstruction: {
          destinationAccount: {
            asset: finp2pAsset(params.settlementAsset),
            account: finIdAccount(params.issuerFinId, params.settlementOrgId, params.custodianOrgId),
          },
        },
      }],
    },
  }));
  if (!res.id) throw new Error('Failed to create primary sale intent');
  return res.id;
}

export interface SellingIntentParams {
  asset: Finp2pAsset;
  settlementAsset: Finp2pAsset;
  sellingAmount: number;
  sellerId: string;
  sellerFinId: string;
  price: number;
  settlementOrgId: string;
  custodianOrgId: string;
}

export async function createSellingIntent(client: FinP2PClient, params: SellingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const { start, end } = intentWindow();

  const res = await unwrapOperation<{ id: string }>(client, client.createIntent(params.asset.id, {
    start, end,
    intent: {
      type: 'sellingIntent',
      seller: params.sellerId,
      asset: {
        assetTerm: { amount: String(params.sellingAmount) },
        assetInstruction: {
          sourceAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.sellerFinId, assetOrgId, params.custodianOrgId),
          },
        },
      },
      settlement: [{
        settlementTerm: { type: 'partialSettlement', unitValue: params.price.toFixed(2) },
        settlementInstruction: {
          destinationAccount: {
            asset: finp2pAsset(params.settlementAsset),
            account: finIdAccount(params.sellerFinId, params.settlementOrgId, params.custodianOrgId),
          },
        },
      }],
      signaturePolicy: { type: 'manualPolicy' },
    },
  }));
  if (!res.id) throw new Error('Failed to create selling intent');
  return res.id;
}

export interface BuyingIntentParams {
  asset: Finp2pAsset;
  settlementAsset: Finp2pAsset;
  buyingAmount: number;
  buyerId: string;
  buyerFinId: string;
  price: number;
  settlementOrgId: string;
  custodianOrgId: string;
}

export async function createBuyingIntent(client: FinP2PClient, params: BuyingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const { start, end } = intentWindow();

  const res = await unwrapOperation<{ id: string }>(client, client.createIntent(params.asset.id, {
    start, end,
    intent: {
      type: 'buyingIntent',
      buyer: params.buyerId,
      asset: {
        assetTerm: { amount: String(params.buyingAmount) },
        assetInstruction: {
          destinationAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.buyerFinId, assetOrgId, params.custodianOrgId),
          },
        },
      },
      settlement: {
        settlementTerm: { type: 'partialSettlement', unitValue: params.price.toFixed(2) },
        settlementInstruction: {
          sourceAccount: {
            asset: finp2pAsset(params.settlementAsset),
            account: finIdAccount(params.buyerFinId, params.settlementOrgId, params.custodianOrgId),
          },
        },
      },
      signaturePolicy: { type: 'manualPolicy' },
    },
  }));
  if (!res.id) throw new Error('Failed to create buying intent');
  return res.id;
}

export interface RedemptionIntentParams {
  asset: Finp2pAsset;
  settlementAsset: Finp2pAsset;
  redemptionAmount: number;
  issuerId: string;
  issuerFinId: string;
  price: number;
  settlementOrgId: string;
  custodianOrgId: string;
}

export async function createRedemptionIntent(client: FinP2PClient, params: RedemptionIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const { start, end } = intentWindow();

  const res = await unwrapOperation<{ id: string }>(client, client.createIntent(params.asset.id, {
    start, end,
    intent: {
      type: 'redemptionIntent',
      issuer: params.issuerId,
      asset: {
        assetTerm: { amount: String(params.redemptionAmount) },
        assetInstruction: {
          destinationAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.issuerFinId, assetOrgId, params.custodianOrgId),
          },
        },
      },
      settlement: [{
        settlementTerm: { type: 'partialSettlement', unitValue: params.price.toFixed(2) },
        settlementInstruction: {
          sourceAccount: {
            asset: finp2pAsset(params.settlementAsset),
            account: finIdAccount(params.issuerFinId, params.settlementOrgId, params.custodianOrgId),
          },
        },
      }],
      signaturePolicy: { type: 'manualPolicy' },
    },
  }));
  if (!res.id) throw new Error('Failed to create redemption intent');
  return res.id;
}

/** Loan-specific conditions (required when `loanInstruction` is provided). */
export type LoanConditions =
  | { type: 'repaymentTerm'; closeAmount: string; interestRate?: string }
  | { type: 'interestTerm'; interestRate: string }
  | { type: 'closeAmountTerm'; closeAmount: string };

export interface LoanIntentParams {
  asset: Finp2pAsset;
  settlementAsset: Finp2pAsset;
  loanAmount: number;
  creatorType: 'borrower' | 'lender';
  borrowerId: string;
  borrowerFinId: string;
  lenderId: string;
  lenderFinId: string;
  price: number;
  settlementOrgId: string;
  custodianOrgId: string;
  /** Epoch seconds */
  openDate?: number;
  /** Epoch seconds */
  closeDate?: number;
  conditions?: LoanConditions;
}

export async function createLoanIntent(client: FinP2PClient, params: LoanIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const { start, end } = intentWindow();

  const borrowerAccount = (assetRef: Finp2pAsset) => ({
    asset: finp2pAsset(assetRef),
    account: finIdAccount(params.borrowerFinId, assetOrgId, params.custodianOrgId),
  });
  const lenderAccount = (assetRef: Finp2pAsset) => ({
    asset: finp2pAsset(assetRef),
    account: finIdAccount(params.lenderFinId, assetOrgId, params.custodianOrgId),
  });

  // `loanInstruction.conditions` is required by the schema, so only include
  // `loanInstruction` when the caller supplied `conditions`.
  const loanInstruction = params.conditions
    ? {
      openDate: params.openDate ?? start,
      closeDate: params.closeDate ?? end,
      conditions: params.conditions,
    }
    : undefined;

  const res = await unwrapOperation<{ id: string }>(client, client.createIntent(params.asset.id, {
    start, end,
    intent: {
      type: 'loanIntent',
      creatorType: params.creatorType,
      borrower: params.borrowerId,
      lender: params.lenderId,
      asset: {
        assetTerm: { amount: String(params.loanAmount) },
        assetInstruction: {
          borrowerAccount: borrowerAccount(params.asset),
          lenderAccount: lenderAccount(params.asset),
        },
      },
      settlement: [{
        settlementTerm: { type: 'partialSettlement', unitValue: params.price.toFixed(2) },
        settlementInstruction: {
          borrowerAccount: borrowerAccount(params.settlementAsset),
          lenderAccount: lenderAccount(params.settlementAsset),
        },
      }],
      loanInstruction,
    },
  }));
  if (!res.id) throw new Error('Failed to create loan intent');
  return res.id;
}

export interface RequestForTransferIntentParams {
  asset: Finp2pAsset;
  amount: number;
  senderId: string;
  senderFinId: string;
  receiverId: string;
  receiverFinId: string;
  action: 'send' | 'request';
  custodianOrgId: string;
}

export async function createRequestForTransferIntent(
  client: FinP2PClient,
  params: RequestForTransferIntentParams,
): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const { start, end } = intentWindow();

  // `send`: sender initiates, provides senderAccount.
  // `request`: receiver initiates, provides receiverAccount.
  const assetInstruction = params.action === 'send'
    ? {
      action: 'send' as const,
      senderAccount: {
        asset: finp2pAsset(params.asset),
        account: finIdAccount(params.senderFinId, assetOrgId, params.custodianOrgId),
      },
    }
    : {
      action: 'request' as const,
      receiverAccount: {
        asset: finp2pAsset(params.asset),
        account: finIdAccount(params.receiverFinId, assetOrgId, params.custodianOrgId),
      },
    };

  const res = await unwrapOperation<{ id: string }>(client, client.createIntent(params.asset.id, {
    start, end,
    intent: {
      type: 'requestForTransferIntent',
      sender: params.senderId,
      receiver: params.receiverId,
      asset: {
        assetTerm: { amount: String(params.amount) },
        assetInstruction,
      },
      signaturePolicy: { type: 'manualPolicy' },
    },
  }));
  if (!res.id) throw new Error('Failed to create request-for-transfer intent');
  return res.id;
}

// ── Intent execution ──

export interface ExecutePrimarySaleParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  assetAmount: number;
  paymentAmount: number;
  /**
   * Single-binding payment fields. Used for both buyer (settlement source) and
   * seller (settlement destination) when the payment token has one binding
   * across orgs. Optional — pass per-side overrides instead for bilateral
   * DvP-cross where each org binds the payment token as its own resource.
   */
  settlementAsset?: Finp2pAsset;
  settlementOrgId?: string;
  /** Bilateral overrides — when set, take precedence over the single fields. */
  buyerSettlementAsset?: Finp2pAsset;
  sellerSettlementAsset?: Finp2pAsset;
  buyerSettlementOrgId?: string;
  sellerSettlementOrgId?: string;
  buyer: { id: string; finId: string; custodianOrgId: string };
  seller: { id: string; finId: string; custodianOrgId: string };
}

export async function executePrimarySale(client: FinP2PClient, params: ExecutePrimarySaleParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const buyerSettlementAsset  = requireSettlementAsset(params.buyerSettlementAsset  ?? params.settlementAsset,  'buyer');
  const sellerSettlementAsset = requireSettlementAsset(params.sellerSettlementAsset ?? params.settlementAsset, 'seller');
  const buyerSettlementOrgId  = requireSettlementOrgId(params.buyerSettlementOrgId  ?? params.settlementOrgId,  'buyer');
  const sellerSettlementOrgId = requireSettlementOrgId(params.sellerSettlementOrgId ?? params.settlementOrgId, 'seller');

  const res = await unwrapOperation<{ executionPlanId: string }>(client, client.executeIntent({
    user: params.seller.id,
    intentId: params.intentId,
    executionId: params.executionId,
    intent: {
      type: 'primarySaleExecution',
      nonce: hexNonce(),
      issuer: params.seller.id,
      buyer: params.buyer.id,
      // `issuingAsset`: source only carries asset metadata (no account — the issuer
      // mints), destination carries the buyer's finp2p account.
      asset: {
        assetTerm: { amount: String(params.assetAmount) },
        assetInstruction: {
          sourceAccount: {
            asset: finp2pAsset(params.asset),
          },
          destinationAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.buyer.finId, assetOrgId, params.buyer.custodianOrgId),
          },
        },
      },
      settlement: {
        term: { amount: String(params.paymentAmount) },
        instruction: {
          sourceAccount: {
            asset: finp2pAsset(buyerSettlementAsset),
            account: finIdAccount(params.buyer.finId, buyerSettlementOrgId, params.buyer.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(sellerSettlementAsset),
            account: finIdAccount(params.seller.finId, sellerSettlementOrgId, params.seller.custodianOrgId),
          },
        },
      },
    },
  }));
  if (!res.executionPlanId) throw new Error('Failed to execute primary sale');
  return res.executionPlanId;
}

export interface ExecuteSellingIntentParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  assetAmount: number;
  paymentAmount: number;
  settlementAsset?: Finp2pAsset;
  settlementOrgId?: string;
  /** Bilateral overrides — see ExecutePrimarySaleParams. */
  buyerSettlementAsset?: Finp2pAsset;
  sellerSettlementAsset?: Finp2pAsset;
  buyerSettlementOrgId?: string;
  sellerSettlementOrgId?: string;
  buyer: { id: string; finId: string; custodianOrgId: string };
  seller: { id: string; finId: string; custodianOrgId: string };
}

export async function executeSellingIntent(client: FinP2PClient, params: ExecuteSellingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const buyerSettlementAsset  = requireSettlementAsset(params.buyerSettlementAsset  ?? params.settlementAsset,  'buyer');
  const sellerSettlementAsset = requireSettlementAsset(params.sellerSettlementAsset ?? params.settlementAsset, 'seller');
  const buyerSettlementOrgId  = requireSettlementOrgId(params.buyerSettlementOrgId  ?? params.settlementOrgId,  'buyer');
  const sellerSettlementOrgId = requireSettlementOrgId(params.sellerSettlementOrgId ?? params.settlementOrgId, 'seller');

  const res = await unwrapOperation<{ executionPlanId: string }>(client, client.executeIntent({
    user: params.seller.id,
    intentId: params.intentId,
    executionId: params.executionId,
    intent: {
      type: 'sellingIntentExecution',
      nonce: hexNonce(),
      buyer: params.buyer.id,
      asset: {
        term: { amount: String(params.assetAmount) },
        instruction: {
          sourceAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.seller.finId, assetOrgId, params.seller.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.buyer.finId, assetOrgId, params.buyer.custodianOrgId),
          },
        },
      },
      settlement: {
        term: { amount: String(params.paymentAmount) },
        instruction: {
          sourceAccount: {
            asset: finp2pAsset(buyerSettlementAsset),
            account: finIdAccount(params.buyer.finId, buyerSettlementOrgId, params.buyer.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(sellerSettlementAsset),
            account: finIdAccount(params.seller.finId, sellerSettlementOrgId, params.seller.custodianOrgId),
          },
        },
      },
    },
  }));
  if (!res.executionPlanId) throw new Error('Failed to execute selling intent');
  return res.executionPlanId;
}

export interface ExecuteBuyingIntentParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  assetAmount: number;
  paymentAmount: number;
  settlementAsset?: Finp2pAsset;
  settlementOrgId?: string;
  /** Bilateral overrides — see ExecutePrimarySaleParams. */
  buyerSettlementAsset?: Finp2pAsset;
  sellerSettlementAsset?: Finp2pAsset;
  buyerSettlementOrgId?: string;
  sellerSettlementOrgId?: string;
  buyer: { id: string; finId: string; custodianOrgId: string };
  seller: { id: string; finId: string; custodianOrgId: string };
}

export async function executeBuyingIntent(client: FinP2PClient, params: ExecuteBuyingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const buyerSettlementAsset  = requireSettlementAsset(params.buyerSettlementAsset  ?? params.settlementAsset,  'buyer');
  const sellerSettlementAsset = requireSettlementAsset(params.sellerSettlementAsset ?? params.settlementAsset, 'seller');
  const buyerSettlementOrgId  = requireSettlementOrgId(params.buyerSettlementOrgId  ?? params.settlementOrgId,  'buyer');
  const sellerSettlementOrgId = requireSettlementOrgId(params.sellerSettlementOrgId ?? params.settlementOrgId, 'seller');

  const res = await unwrapOperation<{ executionPlanId: string }>(client, client.executeIntent({
    user: params.buyer.id,
    intentId: params.intentId,
    executionId: params.executionId,
    intent: {
      type: 'buyingIntentExecution',
      nonce: hexNonce(),
      seller: params.seller.id,
      asset: {
        term: { amount: String(params.assetAmount) },
        instruction: {
          sourceAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.seller.finId, assetOrgId, params.seller.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.buyer.finId, assetOrgId, params.buyer.custodianOrgId),
          },
        },
      },
      settlement: {
        term: { amount: String(params.paymentAmount) },
        instruction: {
          sourceAccount: {
            asset: finp2pAsset(buyerSettlementAsset),
            account: finIdAccount(params.buyer.finId, buyerSettlementOrgId, params.buyer.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(sellerSettlementAsset),
            account: finIdAccount(params.seller.finId, sellerSettlementOrgId, params.seller.custodianOrgId),
          },
        },
      },
    },
  }));
  if (!res.executionPlanId) throw new Error('Failed to execute buying intent');
  return res.executionPlanId;
}

export interface ExecuteRedemptionIntentParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  assetAmount: number;
  paymentAmount: number;
  settlementAsset?: Finp2pAsset;
  settlementOrgId?: string;
  /**
   * Bilateral overrides for redemption — settlement source is the issuer
   * (paying out), destination is the seller (receiving payment).
   */
  issuerSettlementAsset?: Finp2pAsset;
  sellerSettlementAsset?: Finp2pAsset;
  issuerSettlementOrgId?: string;
  sellerSettlementOrgId?: string;
  seller: { id: string; finId: string; custodianOrgId: string };
  issuer: { id: string; finId: string; custodianOrgId: string };
}

export async function executeRedemptionIntent(client: FinP2PClient, params: ExecuteRedemptionIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const issuerSettlementAsset = requireSettlementAsset(params.issuerSettlementAsset ?? params.settlementAsset, 'issuer');
  const sellerSettlementAsset = requireSettlementAsset(params.sellerSettlementAsset ?? params.settlementAsset, 'seller');
  const issuerSettlementOrgId = requireSettlementOrgId(params.issuerSettlementOrgId ?? params.settlementOrgId, 'issuer');
  const sellerSettlementOrgId = requireSettlementOrgId(params.sellerSettlementOrgId ?? params.settlementOrgId, 'seller');

  const res = await unwrapOperation<{ executionPlanId: string }>(client, client.executeIntent({
    user: params.issuer.id,
    intentId: params.intentId,
    executionId: params.executionId,
    intent: {
      type: 'redemptionIntentExecution',
      nonce: hexNonce(),
      issuer: params.issuer.id,
      seller: params.seller.id,
      // `redemptionIntentExecution.asset` requires both source (seller's holdings)
      // and destination (optional account on issuer side, asset-only here).
      asset: {
        term: { amount: String(params.assetAmount) },
        instruction: {
          sourceAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.seller.finId, assetOrgId, params.seller.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(params.asset),
          },
        },
      },
      settlement: {
        term: { amount: String(params.paymentAmount) },
        instruction: {
          sourceAccount: {
            asset: finp2pAsset(issuerSettlementAsset),
            account: finIdAccount(params.issuer.finId, issuerSettlementOrgId, params.issuer.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(sellerSettlementAsset),
            account: finIdAccount(params.seller.finId, sellerSettlementOrgId, params.seller.custodianOrgId),
          },
        },
      },
    },
  }));
  if (!res.executionPlanId) throw new Error('Failed to execute redemption intent');
  return res.executionPlanId;
}

export interface ExecuteLoanIntentParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  settlementAsset: Finp2pAsset;
  assetAmount: number;
  paymentAmount: number;
  settlementOrgId: string;
  executorType: 'borrower' | 'lender';
  borrower: { id: string; finId: string; custodianOrgId: string };
  lender: { id: string; finId: string; custodianOrgId: string };
}

export async function executeLoanIntent(client: FinP2PClient, params: ExecuteLoanIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const user = params.executorType === 'borrower' ? params.borrower.id : params.lender.id;

  const res = await unwrapOperation<{ executionPlanId: string }>(client, client.executeIntent({
    user,
    intentId: params.intentId,
    executionId: params.executionId,
    intent: {
      type: 'loanIntentExecution',
      executorType: params.executorType,
      nonce: hexNonce(),
      borrower: params.borrower.id,
      lender: params.lender.id,
      asset: {
        assetTerm: { amount: String(params.assetAmount) },
        assetInstruction: {
          borrowerAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.borrower.finId, assetOrgId, params.borrower.custodianOrgId),
          },
          lenderAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.lender.finId, assetOrgId, params.lender.custodianOrgId),
          },
        },
      },
      settlement: {
        assetTerm: { amount: String(params.paymentAmount) },
        assetInstruction: {
          borrowerAccount: {
            asset: finp2pAsset(params.settlementAsset),
            account: finIdAccount(params.borrower.finId, params.settlementOrgId, params.borrower.custodianOrgId),
          },
          lenderAccount: {
            asset: finp2pAsset(params.settlementAsset),
            account: finIdAccount(params.lender.finId, params.settlementOrgId, params.lender.custodianOrgId),
          },
        },
      },
    },
  }));
  if (!res.executionPlanId) throw new Error('Failed to execute loan intent');
  return res.executionPlanId;
}

export interface ExecuteRequestForTransferIntentParams {
  intentId: string;
  executionId: string;
  /**
   * Single-binding asset — used for both sender (source) and receiver
   * (destination) when the asset has one binding across orgs. The orgId
   * extracted from `asset.id` is used for both sides unless overridden.
   */
  asset: Finp2pAsset;
  amount: number;
  /**
   * Bilateral overrides — when set, take precedence over the single fields.
   * Use these when sender and receiver orgs each bind the same on-chain
   * token as their own FinP2P resource (DvP-cross style transfers).
   */
  senderAsset?: Finp2pAsset;
  receiverAsset?: Finp2pAsset;
  senderOrgId?: string;
  receiverOrgId?: string;
  sender: { id: string; finId: string; custodianOrgId: string };
  receiver: { id: string; finId: string; custodianOrgId: string };
  action: 'send' | 'request';
}

export async function executeRequestForTransferIntent(
  client: FinP2PClient,
  params: ExecuteRequestForTransferIntentParams,
): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const senderAsset   = params.senderAsset   ?? params.asset;
  const receiverAsset = params.receiverAsset ?? params.asset;
  const senderOrgId   = params.senderOrgId   ?? assetOrgId;
  const receiverOrgId = params.receiverOrgId ?? assetOrgId;

  // Counterparty to the action initiates execution:
  // `send`: sender initiated → receiver executes
  // `request`: receiver initiated → sender executes
  const user = params.action === 'send' ? params.receiver.id : params.sender.id;

  const res = await unwrapOperation<{ executionPlanId: string }>(client, client.executeIntent({
    user,
    intentId: params.intentId,
    executionId: params.executionId,
    intent: {
      type: 'requestForTransferIntentExecution',
      nonce: hexNonce(),
      action: params.action,
      sender: params.sender.id,
      receiver: params.receiver.id,
      asset: {
        term: { amount: String(params.amount) },
        instruction: {
          sourceAccount: {
            asset: finp2pAsset(senderAsset),
            account: finIdAccount(params.sender.finId, senderOrgId, params.sender.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(receiverAsset),
            account: finIdAccount(params.receiver.finId, receiverOrgId, params.receiver.custodianOrgId),
          },
        },
      },
    },
  }));
  if (!res.executionPlanId) throw new Error('Failed to execute request-for-transfer intent');
  return res.executionPlanId;
}

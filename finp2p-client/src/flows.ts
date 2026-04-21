/**
 * High-level FinP2P flow methods: intent creation, execution, and asset management.
 *
 * These compose the low-level FinAPIClient methods (createIntent, executeIntent, etc.)
 * with structured parameter objects and automatic async operation polling.
 */
import type { FinP2PClient } from './client';
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

async function unwrap(client: FinP2PClient, result: any, label: string): Promise<any> {
  if (result.error) {
    throw new Error(`${label}: ${JSON.stringify(result.error)}`);
  }
  const data = result.data;
  if (data?.cid && !data.id) {
    return client.waitForOperationCompletion(data.cid, OP_TIMEOUT);
  }
  return data;
}

// ── Asset creation ──

export interface CreateAssetParams {
  name: string;
  /** Asset classification (Equity, Debt, Cryptocurrency, Fiat, etc.) */
  type: 'Equity' | 'Debt' | 'Loans' | 'Fund' | 'RealEstate' | 'Commodity' | 'Fiat' | 'Cryptocurrency' | 'TokenizedCash' | 'DigitalNatives' | 'Basket' | 'Other';
  issuerId: string;
  symbol?: string;
  denominationCode: string;
  /** How the asset is denominated for settlement purposes. Defaults to 'finp2p'. */
  denominationType?: 'finp2p' | 'fiat' | 'cryptocurrency';
  intentTypes: Array<'primarySale' | 'buyingIntent' | 'sellingIntent' | 'loanIntent' | 'redemptionIntent' | 'privateOfferIntent' | 'requestForTransferIntent'>;
  /** Logical ledger name, must match the ledgerName registered via /ledger/bind */
  ledger: string;
  /** CAIP-2 chain id, e.g. 'eip155:11155111' (Sepolia) */
  network: string;
  /** Token identifier on the ledger (e.g. ERC-20 contract address) */
  tokenId: string;
  /** Token standard, e.g. 'erc20' */
  standard: string;
  assetPolicies?: any;
  config?: string;
  metadata?: any;
  /** Optional financial asset identifier (ISIN/ISO4217/NONE) */
  financialIdentifier?:
  | { assetIdentifierType: 'ISIN'; assetIdentifierValue: string }
  | { assetIdentifierType: 'ISO4217'; assetIdentifierValue: string }
  | { assetIdentifierType: 'NONE' };
}

export async function createAsset(client: FinP2PClient, params: CreateAssetParams): Promise<string> {
  const result = await client.createAsset(
    params.name,
    params.type,
    params.issuerId,
    params.symbol,
    { type: params.denominationType ?? 'finp2p', code: params.denominationCode },
    params.intentTypes,
    {
      ledger: params.ledger,
      bind: {
        assetIdentifierType: 'CAIP-19' as const,
        network: params.network,
        tokenId: params.tokenId,
        standard: params.standard,
      },
    },
    params.assetPolicies,
    params.config,
    params.metadata,
    params.financialIdentifier,
  );

  const res = await unwrap(client, result, 'createAsset');
  const assetId = res?.id;
  if (!assetId) throw new Error('Failed to create asset');
  return assetId;
}

// ── Intent creation ──

export interface PrimarySaleParams {
  asset: Finp2pAsset;
  paymentAsset: Finp2pAsset;
  issuanceAmount: number;
  issuerId: string;
  issuerFinId: string;
  price: number;
  paymentOrgId: string;
  custodianOrgId: string;
}

export async function createPrimarySale(client: FinP2PClient, params: PrimarySaleParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const { start, end } = intentWindow();

  const result = await client.createIntent(params.asset.id, {
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
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.issuerFinId, params.paymentOrgId, params.custodianOrgId),
          },
        },
      }],
    },
  });

  const res = await unwrap(client, result, 'createPrimarySale');
  const intentId = res?.id;
  if (!intentId) throw new Error('Failed to create primary sale intent');
  return intentId;
}

export interface SellingIntentParams {
  asset: Finp2pAsset;
  paymentAsset: Finp2pAsset;
  sellingAmount: number;
  sellerId: string;
  sellerFinId: string;
  price: number;
  paymentOrgId: string;
  custodianOrgId: string;
}

export async function createSellingIntent(client: FinP2PClient, params: SellingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const { start, end } = intentWindow();

  const result = await client.createIntent(params.asset.id, {
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
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.sellerFinId, params.paymentOrgId, params.custodianOrgId),
          },
        },
      }],
      signaturePolicy: { type: 'manualPolicy' },
    },
  });

  const res = await unwrap(client, result, 'createSellingIntent');
  const intentId = res?.id;
  if (!intentId) throw new Error('Failed to create selling intent');
  return intentId;
}

export interface BuyingIntentParams {
  asset: Finp2pAsset;
  paymentAsset: Finp2pAsset;
  buyingAmount: number;
  buyerId: string;
  buyerFinId: string;
  price: number;
  paymentOrgId: string;
  custodianOrgId: string;
}

export async function createBuyingIntent(client: FinP2PClient, params: BuyingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const { start, end } = intentWindow();

  const result = await client.createIntent(params.asset.id, {
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
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.buyerFinId, params.paymentOrgId, params.custodianOrgId),
          },
        },
      },
      signaturePolicy: { type: 'manualPolicy' },
    },
  });

  const res = await unwrap(client, result, 'createBuyingIntent');
  const intentId = res?.id;
  if (!intentId) throw new Error('Failed to create buying intent');
  return intentId;
}

export interface RedemptionIntentParams {
  asset: Finp2pAsset;
  paymentAsset: Finp2pAsset;
  redemptionAmount: number;
  issuerId: string;
  issuerFinId: string;
  price: number;
  paymentOrgId: string;
  custodianOrgId: string;
}

export async function createRedemptionIntent(client: FinP2PClient, params: RedemptionIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const { start, end } = intentWindow();

  const result = await client.createIntent(params.asset.id, {
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
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.issuerFinId, params.paymentOrgId, params.custodianOrgId),
          },
        },
      }],
      signaturePolicy: { type: 'manualPolicy' },
    },
  });

  const res = await unwrap(client, result, 'createRedemptionIntent');
  const intentId = res?.id;
  if (!intentId) throw new Error('Failed to create redemption intent');
  return intentId;
}

/** Loan-specific conditions (required when `loanInstruction` is provided). */
export type LoanConditions =
  | { type: 'repaymentTerm'; closeAmount: string; interestRate?: string }
  | { type: 'interestTerm'; interestRate: string }
  | { type: 'closeAmountTerm'; closeAmount: string };

export interface LoanIntentParams {
  asset: Finp2pAsset;
  paymentAsset: Finp2pAsset;
  loanAmount: number;
  creatorType: 'borrower' | 'lender';
  borrowerId: string;
  borrowerFinId: string;
  lenderId: string;
  lenderFinId: string;
  price: number;
  paymentOrgId: string;
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

  const result = await client.createIntent(params.asset.id, {
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
          borrowerAccount: borrowerAccount(params.paymentAsset),
          lenderAccount: lenderAccount(params.paymentAsset),
        },
      }],
      loanInstruction,
    },
  });

  const res = await unwrap(client, result, 'createLoanIntent');
  const intentId = res?.id;
  if (!intentId) throw new Error('Failed to create loan intent');
  return intentId;
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

  const result = await client.createIntent(params.asset.id, {
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
  });

  const res = await unwrap(client, result, 'createRequestForTransferIntent');
  const intentId = res?.id;
  if (!intentId) throw new Error('Failed to create request-for-transfer intent');
  return intentId;
}

// ── Intent execution ──

export interface ExecutePrimarySaleParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  paymentAsset: Finp2pAsset;
  assetAmount: number;
  paymentAmount: number;
  paymentOrgId: string;
  buyer: { id: string; finId: string; custodianOrgId: string };
  seller: { id: string; finId: string; custodianOrgId: string };
}

export async function executePrimarySale(client: FinP2PClient, params: ExecutePrimarySaleParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);

  const result = await client.executeIntent({
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
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.buyer.finId, params.paymentOrgId, params.buyer.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.seller.finId, params.paymentOrgId, params.seller.custodianOrgId),
          },
        },
      },
    },
  });

  const res = await unwrap(client, result, 'executePrimarySale');
  const planId = res?.executionPlanId ?? res?.response?.executionPlanId;
  if (!planId) throw new Error('Failed to execute primary sale');
  return planId;
}

export interface ExecuteSellingIntentParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  paymentAsset: Finp2pAsset;
  assetAmount: number;
  paymentAmount: number;
  paymentOrgId: string;
  buyer: { id: string; finId: string; custodianOrgId: string };
  seller: { id: string; finId: string; custodianOrgId: string };
}

export async function executeSellingIntent(client: FinP2PClient, params: ExecuteSellingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);

  const result = await client.executeIntent({
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
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.buyer.finId, params.paymentOrgId, params.buyer.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.seller.finId, params.paymentOrgId, params.seller.custodianOrgId),
          },
        },
      },
    },
  });

  const res = await unwrap(client, result, 'executeSellingIntent');
  const planId = res?.executionPlanId ?? res?.response?.executionPlanId;
  if (!planId) throw new Error('Failed to execute selling intent');
  return planId;
}

export interface ExecuteBuyingIntentParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  paymentAsset: Finp2pAsset;
  assetAmount: number;
  paymentAmount: number;
  paymentOrgId: string;
  buyer: { id: string; finId: string; custodianOrgId: string };
  seller: { id: string; finId: string; custodianOrgId: string };
}

export async function executeBuyingIntent(client: FinP2PClient, params: ExecuteBuyingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);

  const result = await client.executeIntent({
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
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.buyer.finId, params.paymentOrgId, params.buyer.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.seller.finId, params.paymentOrgId, params.seller.custodianOrgId),
          },
        },
      },
    },
  });

  const res = await unwrap(client, result, 'executeBuyingIntent');
  const planId = res?.executionPlanId ?? res?.response?.executionPlanId;
  if (!planId) throw new Error('Failed to execute buying intent');
  return planId;
}

export interface ExecuteRedemptionIntentParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  paymentAsset: Finp2pAsset;
  assetAmount: number;
  paymentAmount: number;
  paymentOrgId: string;
  seller: { id: string; finId: string; custodianOrgId: string };
  issuer: { id: string; finId: string; custodianOrgId: string };
}

export async function executeRedemptionIntent(client: FinP2PClient, params: ExecuteRedemptionIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);

  const result = await client.executeIntent({
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
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.issuer.finId, params.paymentOrgId, params.issuer.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.seller.finId, params.paymentOrgId, params.seller.custodianOrgId),
          },
        },
      },
    },
  });

  const res = await unwrap(client, result, 'executeRedemptionIntent');
  const planId = res?.executionPlanId ?? res?.response?.executionPlanId;
  if (!planId) throw new Error('Failed to execute redemption intent');
  return planId;
}

export interface ExecuteLoanIntentParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  paymentAsset: Finp2pAsset;
  assetAmount: number;
  paymentAmount: number;
  paymentOrgId: string;
  executorType: 'borrower' | 'lender';
  borrower: { id: string; finId: string; custodianOrgId: string };
  lender: { id: string; finId: string; custodianOrgId: string };
}

export async function executeLoanIntent(client: FinP2PClient, params: ExecuteLoanIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);
  const user = params.executorType === 'borrower' ? params.borrower.id : params.lender.id;

  const result = await client.executeIntent({
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
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.borrower.finId, params.paymentOrgId, params.borrower.custodianOrgId),
          },
          lenderAccount: {
            asset: finp2pAsset(params.paymentAsset),
            account: finIdAccount(params.lender.finId, params.paymentOrgId, params.lender.custodianOrgId),
          },
        },
      },
    },
  });

  const res = await unwrap(client, result, 'executeLoanIntent');
  const planId = res?.executionPlanId ?? res?.response?.executionPlanId;
  if (!planId) throw new Error('Failed to execute loan intent');
  return planId;
}

export interface ExecuteRequestForTransferIntentParams {
  intentId: string;
  executionId: string;
  asset: Finp2pAsset;
  amount: number;
  sender: { id: string; finId: string; custodianOrgId: string };
  receiver: { id: string; finId: string; custodianOrgId: string };
  action: 'send' | 'request';
}

export async function executeRequestForTransferIntent(
  client: FinP2PClient,
  params: ExecuteRequestForTransferIntentParams,
): Promise<string> {
  const assetOrgId = extractOrgId(params.asset.id);

  // Counterparty to the action initiates execution:
  // `send`: sender initiated → receiver executes
  // `request`: receiver initiated → sender executes
  const user = params.action === 'send' ? params.receiver.id : params.sender.id;

  const result = await client.executeIntent({
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
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.sender.finId, assetOrgId, params.sender.custodianOrgId),
          },
          destinationAccount: {
            asset: finp2pAsset(params.asset),
            account: finIdAccount(params.receiver.finId, assetOrgId, params.receiver.custodianOrgId),
          },
        },
      },
    },
  });

  const res = await unwrap(client, result, 'executeRequestForTransferIntent');
  const planId = res?.executionPlanId ?? res?.response?.executionPlanId;
  if (!planId) throw new Error('Failed to execute request-for-transfer intent');
  return planId;
}

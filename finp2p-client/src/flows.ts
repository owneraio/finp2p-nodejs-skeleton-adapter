/**
 * High-level FinP2P flow methods: intent creation, execution, and asset management.
 *
 * These compose the low-level FinAPIClient methods (createIntent, executeIntent, etc.)
 * with structured parameter objects and automatic async operation polling.
 */
import type { FinP2PClient } from './client';
import { extractOrgId, hexNonce, finIdAccount, settlementAccount } from './finapi/utils';

const OP_TIMEOUT = 100_000;

type SettlementAsset = { type: 'fiat'; code: string } | { type: 'finp2p'; resourceId: string };

function makeSettlementAsset(paymentAssetCode: string, paymentAssetId?: string): SettlementAsset {
  return paymentAssetId
    ? { type: 'finp2p', resourceId: paymentAssetId }
    : { type: 'fiat', code: paymentAssetCode };
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

// ── Intent creation ──

export interface PrimarySaleParams {
  assetId: string;
  issuanceAmount: number;
  issuerId: string;
  issuerFinId: string;
  paymentAssetCode: string;
  paymentAssetId?: string;
  price: number;
  paymentOrgId: string;
  custodianOrgId: string;
}

export async function createPrimarySale(client: FinP2PClient, params: PrimarySaleParams): Promise<string> {
  const assetOrgId = extractOrgId(params.assetId);
  const { start, end } = intentWindow();
  const settlement = makeSettlementAsset(params.paymentAssetCode, params.paymentAssetId);

  const result = await (client.createIntent as any)(params.assetId, {
    start, end,
    intent: {
      type: 'primarySale',
      issuer: params.issuerId,
      assetTerm: {
        asset: { type: 'finp2p', resourceId: params.assetId },
        amount: String(params.issuanceAmount),
      },
      assetInstruction: {
        account: {
          asset: { type: 'finp2p', resourceId: params.assetId },
          account: finIdAccount(params.issuerFinId, assetOrgId, params.custodianOrgId),
        },
      },
      settlementTerm: {
        type: 'partialSettlement',
        asset: settlement,
        unitValue: params.price.toFixed(2),
      },
      settlementInstruction: {
        destinationAccounts: [{
          asset: settlement,
          account: finIdAccount(params.issuerFinId, params.paymentOrgId, params.custodianOrgId),
        }],
      },
    },
  });

  const res = await unwrap(client, result, 'createPrimarySale');
  const intentId = res?.id;
  if (!intentId) throw new Error('Failed to create primary sale intent');
  return intentId;
}

export interface SellingIntentParams {
  assetId: string;
  sellingAmount: number;
  sellerId: string;
  sellerFinId: string;
  paymentAssetCode: string;
  paymentAssetId?: string;
  price: number;
  paymentOrgId: string;
  custodianOrgId: string;
  sellerCryptoAddress?: string;
}

export async function createSellingIntent(client: FinP2PClient, params: SellingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.assetId);
  const { start, end } = intentWindow();
  const settlement = makeSettlementAsset(params.paymentAssetCode, params.paymentAssetId);

  const result = await (client.createIntent as any)(params.assetId, {
    start, end,
    intent: {
      type: 'sellingIntent',
      seller: params.sellerId,
      assetTerm: {
        asset: { type: 'finp2p', resourceId: params.assetId },
        amount: String(params.sellingAmount),
      },
      assetInstruction: {
        account: {
          asset: { type: 'finp2p', resourceId: params.assetId },
          account: finIdAccount(params.sellerFinId, assetOrgId, params.custodianOrgId),
        },
      },
      settlementTerm: {
        type: 'partialSettlement',
        asset: settlement,
        unitValue: params.price.toFixed(2),
      },
      settlementInstruction: {
        destinationAccounts: [{
          asset: settlement,
          account: settlementAccount(params.sellerFinId, params.paymentOrgId, params.custodianOrgId, params.sellerCryptoAddress),
        }],
      },
      signaturePolicy: { type: 'manualPolicy' },
    },
  });

  const res = await unwrap(client, result, 'createSellingIntent');
  const intentId = res?.id;
  if (!intentId) throw new Error('Failed to create selling intent');
  return intentId;
}

export interface BuyingIntentParams {
  assetId: string;
  buyingAmount: number;
  buyerId: string;
  buyerFinId: string;
  paymentAssetCode: string;
  paymentAssetId?: string;
  price: number;
  paymentOrgId: string;
  custodianOrgId: string;
  buyerCryptoAddress?: string;
}

export async function createBuyingIntent(client: FinP2PClient, params: BuyingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.assetId);
  const { start, end } = intentWindow();
  const settlement = makeSettlementAsset(params.paymentAssetCode, params.paymentAssetId);

  const result = await (client.createIntent as any)(params.assetId, {
    start, end,
    intent: {
      type: 'buyingIntent',
      buyer: params.buyerId,
      assetTerm: {
        asset: { type: 'finp2p', resourceId: params.assetId },
        amount: String(params.buyingAmount),
      },
      assetInstruction: {
        account: {
          asset: { type: 'finp2p', resourceId: params.assetId },
          account: finIdAccount(params.buyerFinId, assetOrgId, params.custodianOrgId),
        },
      },
      settlementTerm: {
        type: 'partialSettlement',
        asset: settlement,
        unitValue: params.price.toFixed(2),
      },
      settlementInstruction: {
        sourceAccount: {
          asset: settlement,
          account: settlementAccount(params.buyerFinId, params.paymentOrgId, params.custodianOrgId, params.buyerCryptoAddress),
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
  assetId: string;
  redemptionAmount: number;
  issuerId: string;
  issuerFinId: string;
  paymentAssetCode: string;
  paymentAssetId?: string;
  price: number;
  paymentOrgId: string;
  custodianOrgId: string;
}

export async function createRedemptionIntent(client: FinP2PClient, params: RedemptionIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.assetId);
  const { start, end } = intentWindow();
  const settlement = makeSettlementAsset(params.paymentAssetCode, params.paymentAssetId);

  const result = await (client.createIntent as any)(params.assetId, {
    start, end,
    intent: {
      type: 'redemptionIntent',
      issuer: params.issuerId,
      assetTerm: {
        asset: { type: 'finp2p', resourceId: params.assetId },
        amount: String(params.redemptionAmount),
      },
      assetInstruction: {
        account: {
          asset: { type: 'finp2p', resourceId: params.assetId },
          account: finIdAccount(params.issuerFinId, assetOrgId, params.custodianOrgId),
        },
      },
      settlementTerm: {
        type: 'partialSettlement',
        asset: settlement,
        unitValue: params.price.toFixed(2),
      },
      settlementInstruction: {
        sourceAccounts: [{
          asset: settlement,
          account: finIdAccount(params.issuerFinId, params.paymentOrgId, params.custodianOrgId),
        }],
      },
      signaturePolicy: { type: 'manualPolicy' },
      conditions: {},
    },
  });

  const res = await unwrap(client, result, 'createRedemptionIntent');
  const intentId = res?.id;
  if (!intentId) throw new Error('Failed to create redemption intent');
  return intentId;
}

export interface RequestForTransferIntentParams {
  assetId: string;
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
  const assetOrgId = extractOrgId(params.assetId);
  const { start, end } = intentWindow();

  // The side that *initiates* the intent provides its own account.
  // `send`: sender initiates, provides senderAccount.
  // `request`: receiver initiates, provides receiverAccount.
  const assetInstruction = params.action === 'send'
    ? {
      action: 'send',
      senderAccount: {
        asset: { type: 'finp2p', resourceId: params.assetId },
        account: finIdAccount(params.senderFinId, assetOrgId, params.custodianOrgId),
      },
    }
    : {
      action: 'request',
      receiverAccount: {
        asset: { type: 'finp2p', resourceId: params.assetId },
        account: finIdAccount(params.receiverFinId, assetOrgId, params.custodianOrgId),
      },
    };

  const result = await (client.createIntent as any)(params.assetId, {
    start, end,
    intent: {
      type: 'requestForTransferIntent',
      sender: params.senderId,
      receiver: params.receiverId,
      asset: {
        assetTerm: {
          asset: { type: 'finp2p', resourceId: params.assetId },
          amount: String(params.amount),
        },
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
  assetId: string;
  assetAmount: number;
  paymentAssetCode: string;
  paymentAssetId?: string;
  paymentAmount: number;
  paymentOrgId: string;
  buyer: { id: string; finId: string; custodianOrgId: string };
  seller: { id: string; finId: string; custodianOrgId: string };
  buyerCryptoAddress?: string;
  sellerCryptoAddress?: string;
}

export async function executePrimarySale(client: FinP2PClient, params: ExecutePrimarySaleParams): Promise<string> {
  const assetOrgId = extractOrgId(params.assetId);
  const settlement = makeSettlementAsset(params.paymentAssetCode, params.paymentAssetId);

  const result = await (client.executeIntent as any)({
    user: params.seller.id,
    intentId: params.intentId,
    executionId: params.executionId,
    intent: {
      type: 'primarySaleExecution',
      nonce: hexNonce(),
      issuer: params.seller.id,
      buyer: params.buyer.id,
      asset: {
        term: { asset: { type: 'finp2p', resourceId: params.assetId }, amount: String(params.assetAmount) },
        instruction: {
          destinationAccount: {
            asset: { type: 'finp2p', resourceId: params.assetId },
            account: finIdAccount(params.buyer.finId, assetOrgId, params.buyer.custodianOrgId),
          },
        },
      },
      settlement: {
        term: { asset: settlement, amount: String(params.paymentAmount) },
        instruction: {
          sourceAccount: { asset: settlement, account: settlementAccount(params.buyer.finId, params.paymentOrgId, params.buyer.custodianOrgId, params.buyerCryptoAddress) },
          destinationAccount: { asset: settlement, account: settlementAccount(params.seller.finId, params.paymentOrgId, params.seller.custodianOrgId, params.sellerCryptoAddress) },
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
  assetId: string;
  assetAmount: number;
  paymentAssetCode: string;
  paymentAssetId?: string;
  paymentAmount: number;
  paymentOrgId: string;
  buyer: { id: string; finId: string; custodianOrgId: string };
  seller: { id: string; finId: string; custodianOrgId: string };
  buyerCryptoAddress?: string;
  sellerCryptoAddress?: string;
}

export async function executeSellingIntent(client: FinP2PClient, params: ExecuteSellingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.assetId);
  const settlement = makeSettlementAsset(params.paymentAssetCode, params.paymentAssetId);

  const result = await (client.executeIntent as any)({
    user: params.seller.id,
    intentId: params.intentId,
    executionId: params.executionId,
    intent: {
      type: 'sellingIntentExecution',
      nonce: hexNonce(),
      buyer: params.buyer.id,
      asset: {
        term: { asset: { type: 'finp2p', resourceId: params.assetId }, amount: String(params.assetAmount) },
        instruction: {
          sourceAccount: { asset: { type: 'finp2p', resourceId: params.assetId }, account: finIdAccount(params.seller.finId, assetOrgId, params.seller.custodianOrgId) },
          destinationAccount: { asset: { type: 'finp2p', resourceId: params.assetId }, account: finIdAccount(params.buyer.finId, assetOrgId, params.buyer.custodianOrgId) },
        },
      },
      settlement: {
        term: { asset: settlement, amount: String(params.paymentAmount) },
        instruction: {
          sourceAccount: { asset: settlement, account: settlementAccount(params.buyer.finId, params.paymentOrgId, params.buyer.custodianOrgId, params.buyerCryptoAddress) },
          destinationAccount: { asset: settlement, account: settlementAccount(params.seller.finId, params.paymentOrgId, params.seller.custodianOrgId, params.sellerCryptoAddress) },
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
  assetId: string;
  assetAmount: number;
  paymentAssetCode: string;
  paymentAssetId?: string;
  paymentAmount: number;
  paymentOrgId: string;
  buyer: { id: string; finId: string; custodianOrgId: string };
  seller: { id: string; finId: string; custodianOrgId: string };
  buyerCryptoAddress?: string;
  sellerCryptoAddress?: string;
}

export async function executeBuyingIntent(client: FinP2PClient, params: ExecuteBuyingIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.assetId);
  const settlement = makeSettlementAsset(params.paymentAssetCode, params.paymentAssetId);

  const result = await (client.executeIntent as any)({
    user: params.buyer.id,
    intentId: params.intentId,
    executionId: params.executionId,
    intent: {
      type: 'buyingIntentExecution',
      nonce: hexNonce(),
      seller: params.seller.id,
      asset: {
        term: { asset: { type: 'finp2p', resourceId: params.assetId }, amount: String(params.assetAmount) },
        instruction: {
          sourceAccount: { asset: { type: 'finp2p', resourceId: params.assetId }, account: finIdAccount(params.seller.finId, assetOrgId, params.seller.custodianOrgId) },
          destinationAccount: { asset: { type: 'finp2p', resourceId: params.assetId }, account: finIdAccount(params.buyer.finId, assetOrgId, params.buyer.custodianOrgId) },
        },
      },
      settlement: {
        term: { asset: settlement, amount: String(params.paymentAmount) },
        instruction: {
          sourceAccount: { asset: settlement, account: settlementAccount(params.buyer.finId, params.paymentOrgId, params.buyer.custodianOrgId, params.buyerCryptoAddress) },
          destinationAccount: { asset: settlement, account: settlementAccount(params.seller.finId, params.paymentOrgId, params.seller.custodianOrgId, params.sellerCryptoAddress) },
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
  assetId: string;
  assetAmount: number;
  paymentAssetCode: string;
  paymentAssetId?: string;
  paymentAmount: number;
  paymentOrgId: string;
  seller: { id: string; finId: string; custodianOrgId: string };
  issuer: { id: string; finId: string; custodianOrgId: string };
}

export async function executeRedemptionIntent(client: FinP2PClient, params: ExecuteRedemptionIntentParams): Promise<string> {
  const assetOrgId = extractOrgId(params.assetId);
  const settlement = makeSettlementAsset(params.paymentAssetCode, params.paymentAssetId);

  const result = await (client.executeIntent as any)({
    user: params.issuer.id,
    intentId: params.intentId,
    executionId: params.executionId,
    intent: {
      type: 'redemptionIntentExecution',
      nonce: hexNonce(),
      issuer: params.issuer.id,
      seller: params.seller.id,
      asset: {
        term: { asset: { type: 'finp2p', resourceId: params.assetId }, amount: String(params.assetAmount) },
        instruction: {
          sourceAccount: { asset: { type: 'finp2p', resourceId: params.assetId }, account: finIdAccount(params.seller.finId, assetOrgId, params.seller.custodianOrgId) },
        },
      },
      settlement: {
        term: { asset: settlement, amount: String(params.paymentAmount) },
        instruction: {
          sourceAccount: { asset: settlement, account: finIdAccount(params.issuer.finId, params.paymentOrgId, params.issuer.custodianOrgId) },
          destinationAccount: { asset: settlement, account: finIdAccount(params.seller.finId, params.paymentOrgId, params.seller.custodianOrgId) },
        },
      },
    },
  });

  const res = await unwrap(client, result, 'executeRedemptionIntent');
  const planId = res?.executionPlanId ?? res?.response?.executionPlanId;
  if (!planId) throw new Error('Failed to execute redemption intent');
  return planId;
}

export interface ExecuteRequestForTransferIntentParams {
  intentId: string;
  executionId: string;
  assetId: string;
  amount: number;
  sender: { id: string; finId: string; custodianOrgId: string };
  receiver: { id: string; finId: string; custodianOrgId: string };
  action: 'send' | 'request';
}

export async function executeRequestForTransferIntent(
  client: FinP2PClient,
  params: ExecuteRequestForTransferIntentParams,
): Promise<string> {
  const assetOrgId = extractOrgId(params.assetId);

  // Counterparty to the action initiates execution:
  // `send`: sender initiated → receiver executes
  // `request`: receiver initiated → sender executes
  const user = params.action === 'send' ? params.receiver.id : params.sender.id;

  const result = await (client.executeIntent as any)({
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
        term: {
          asset: { type: 'finp2p', resourceId: params.assetId },
          amount: String(params.amount),
        },
        instruction: {
          sourceAccount: {
            asset: { type: 'finp2p', resourceId: params.assetId },
            account: finIdAccount(params.sender.finId, assetOrgId, params.sender.custodianOrgId),
          },
          destinationAccount: {
            asset: { type: 'finp2p', resourceId: params.assetId },
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

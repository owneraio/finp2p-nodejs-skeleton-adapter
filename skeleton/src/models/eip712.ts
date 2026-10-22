import { ValidationError } from './errors';


export const enum LegType {
  Asset = 0,
  Settlement = 1,
}

export const enum PrimaryType {
  PrimarySale = 0,
  Buying = 1,
  Selling = 2,
  Redemption = 3,
  Transfer = 4,
  PrivateOffer = 5,
  Loan = 6,
}

export type EIP712Domain  = {
  name: string
  version: string
  chainId: number
  verifyingContract: string
};

export const DOMAIN_TYPE = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
};


export const FINID_TYPE = {
  FinId: [{
    name: 'idkey', type: 'string',
  }],
};

export const TERM_TYPE = {
  Term: [
    { name: 'assetId', type: 'string' },
    { name: 'assetType', type: 'string' },
    { name: 'amount', type: 'string' },
  ],
};

export const PRIMARY_SALE_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  PrimarySale: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'issuer', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const BUYING_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  Buying: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'seller', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const SELLING_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  Selling: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'seller', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const REDEMPTION_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  Redemption: [
    { name: 'nonce', type: 'string' },
    { name: 'seller', type: 'FinId' },
    { name: 'issuer', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const TRANSFER_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  Transfer: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'seller', type: 'FinId' },
    { name: 'asset', type: 'Term' },
  ],
};

export const PRIVATE_OFFER_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  PrivateOffer: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'seller', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const LOAN_TERMS_TYPE = {
  LoanTerms: [
    { name: 'openTime', type: 'string' },
    { name: 'closeTime', type: 'string' },
    { name: 'borrowedMoneyAmount', type: 'string' },
    { name: 'returnedMoneyAmount', type: 'string' },
  ],
};

export const LOAN_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  ...LOAN_TERMS_TYPE,
  Loan: [
    { name: 'nonce', type: 'string' },
    { name: 'borrower', type: 'FinId' },
    { name: 'lender', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
    { name: 'loanTerms', type: 'LoanTerms' },
  ],
};


export const SOURCE_TYPE = {
  Source: [
    { name: 'accountType', type: 'string' },
    { name: 'finId', type: 'string' },
  ],
};

export const DESTINATION_TYPE = {
  Destination: [
    { name: 'accountType', type: 'string' },
    { name: 'finId', type: 'string' },
  ],
};

export const ASSET_TYPE = {
  Asset: [
    { name: 'assetId', type: 'string' },
    { name: 'assetType', type: 'string' },
  ],
};


export const EXECUTION_CONTEXT_TYPE = {
  ExecutionContext: [
    { name: 'executionPlanId', type: 'string' },
    { name: 'instructionSequenceNumber', type: 'string' },
  ],
};

export const TRADE_DETAILS_TYPE = {
  TradeDetails: [
    { name: 'executionContext', type: 'ExecutionContext' },
  ],
};

export const TRANSACTION_DETAILS_TYPE = {
  TransactionDetails: [
    { name: 'operationId', type: 'string' },
    { name: 'transactionId', type: 'string' },
  ],
};


export const RECEIPT_PROOF_TYPES = {
  ...SOURCE_TYPE,
  ...DESTINATION_TYPE,
  ...TRANSACTION_DETAILS_TYPE,
  ...ASSET_TYPE,
  ...EXECUTION_CONTEXT_TYPE,
  ...TRADE_DETAILS_TYPE,
  Receipt: [
    { name: 'id', type: 'string' },
    { name: 'operationType', type: 'string' },
    { name: 'source', type: 'Source' },
    { name: 'destination', type: 'Destination' },
    { name: 'asset', type: 'Asset' },
    { name: 'tradeDetails', type: 'TradeDetails' },
    { name: 'transactionDetails', type: 'TransactionDetails' },
    { name: 'quantity', type: 'string' },
  ],
};


export type EIP712TypeDefinition = { name?: string; fields?: Array<{ name: string; type: string }> };

/** Keyed by the router's own symbol, so a struct named `definitions` can't
 *  shadow the declaration. Read it with {@link eip712Definitions}. */
export const EIP712_DEFINITIONS = Symbol.for('finp2p.eip712.definitions');

/** Map keyed by type name, the shape ethers wants (EIP712Domain excluded).
 *  The router's declaration hangs off {@link EIP712_DEFINITIONS}, and off a
 *  non-enumerable `definitions` alias when no struct claims that name. Both are
 *  invisible to Object.keys/JSON/ethers — which also means JSON.stringify drops
 *  them, so a replayed operation arrives with the map alone and the declaration
 *  is rebuilt by {@link rehydrateEip712Definitions}. */
export type EIP712Types = Record<string, Array<{ name: string; type: string }>> & {
  readonly definitions?: ReadonlyArray<EIP712TypeDefinition>;
  readonly [EIP712_DEFINITIONS]?: ReadonlyArray<EIP712TypeDefinition>;
};

/** The router's declaration, EIP712Domain included, however it was attached. */
export const eip712Definitions = (types: EIP712Types): ReadonlyArray<EIP712TypeDefinition> | undefined => {
  const viaSymbol = (types as any)[EIP712_DEFINITIONS];
  if (viaSymbol) {
    return viaSymbol;
  }
  // Only the non-enumerable alias counts. An enumerable `definitions` is a
  // struct the message declared, and its value is a field list, not a
  // declaration — which is what survives a JSON round trip.
  const alias = Object.getOwnPropertyDescriptor(types, 'definitions');
  return alias && !alias.enumerable && Array.isArray(alias.value) ? alias.value : undefined;
};

/** Canonical EIP-712 domain fields, in order. The domain type lists exactly the
 *  members the domain carries, so the declaration is derived from the domain
 *  rather than assumed — the router sends subsets. */
const EIP712_DOMAIN_FIELDS: Array<{ name: string; type: string }> = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
];

const eip712DomainDefinition = (domain: Record<string, unknown>): EIP712TypeDefinition => ({
  name: 'EIP712Domain',
  fields: EIP712_DOMAIN_FIELDS.filter(f => domain[f.name] !== undefined),
});

export const attachEip712Definitions = (
  map: EIP712Types, definitions: ReadonlyArray<{ name?: string; fields?: any }>,
): EIP712Types => {
  const frozen = Object.freeze(definitions.map(d => Object.freeze({ ...d })));
  Object.defineProperty(map, EIP712_DEFINITIONS, {
    value: frozen, enumerable: false, writable: false, configurable: false,
  });
  // Only when no struct owns the name — defining it otherwise would hide that
  // struct from ethers, which is the collision this symbol exists to avoid.
  if (!Object.prototype.hasOwnProperty.call(map, 'definitions')) {
    Object.defineProperty(map, 'definitions', {
      value: frozen, enumerable: false, writable: false, configurable: false,
    });
  }
  return map;
};

/**
 * Re-attach a declaration lost to JSON.stringify, rebuilding it from the map's
 * own keys. Order follows the map, with EIP712Domain first when `domain` is
 * given — its members are read off the domain, since the router sends subsets
 * and inventing absent ones would change the domain type hash. Without a
 * domain the entry is omitted rather than guessed.
 */
export const rehydrateEip712Definitions = (
  map: EIP712Types, domain?: Record<string, unknown>,
): EIP712Types => {
  if (eip712Definitions(map)) {
    return map;
  }
  const structs = Object.keys(map).map(name => ({
    name, fields: map[name] as Array<{ name: string; type: string }>,
  }));
  return attachEip712Definitions(
    map, domain ? [eip712DomainDefinition(domain), ...structs] : structs);
};

export interface EIP712Message {
}

export type EIP712AssetType = 'finp2p' | 'fiat' | 'cryptocurrency';
export const eip712Term = (assetId: string, assetType: EIP712AssetType, amount: string): EIP712Term => {
  return { assetId, assetType, amount };
};


export interface EIP712Term {
  assetId: string,
  assetType: string,
  amount: string
}

export interface EIP712FinId {
  idkey: string;
}

export const finId = (key: string): EIP712FinId => {
  return { idkey: key };
};

export const loanTerms = (openTime: string, closeTime: string, borrowedMoneyAmount: string, returnedMoneyAmount: string): EIP712LoanTerms => {
  return { openTime, closeTime, borrowedMoneyAmount, returnedMoneyAmount };
};

export const emptyLoanTerms = (): EIP712LoanTerms => {
  return loanTerms('', '', '', '');
};

export interface EIP712LoanTerms {
  openTime: string;
  closeTime: string;
  borrowedMoneyAmount: string;
  returnedMoneyAmount: string;
}

export interface EIP712PrimarySaleMessage extends EIP712Message {
  nonce: string,
  buyer: EIP712FinId,
  issuer: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
}

export interface EIP712BuyingMessage extends EIP712Message {
  nonce: string,
  buyer: EIP712FinId,
  seller: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
}

export interface EIP712SellingMessage extends EIP712Message {
  nonce: string,
  buyer: EIP712FinId,
  seller: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
}

export interface EIP712RedemptionMessage extends EIP712Message {
  nonce: string,
  seller: EIP712FinId,
  issuer: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
}

export interface EIP712TransferMessage extends EIP712Message {
  nonce: string,
  buyer: EIP712FinId,
  seller: EIP712FinId,
  asset: EIP712Term,
}

export interface EIP712PrivateOfferMessage extends EIP712Message {
  nonce: string,
  buyer: EIP712FinId,
  seller: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
}

export interface EIP712LoanMessage extends EIP712Message {
  nonce: string,
  borrower: EIP712FinId,
  lender: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
  loanTerms: EIP712LoanTerms
}

export type EIP712AccountType = 'finId' | 'iban' | 'cryptoWallet';

export interface EIP712Source {
  accountType: EIP712AccountType | '';
  finId: string;
}

export const eip712Source = (accountType: EIP712AccountType, finId: string): EIP712Source => {
  return { accountType, finId };
};

export interface EIP712Destination {
  accountType: EIP712AccountType | '';
  finId: string;
}

export const eip712Destination = (accountType: EIP712AccountType, finId: string): EIP712Destination => {
  return { accountType, finId };
};

export interface EIP712Asset {
  assetId: string;
  assetType: EIP712AssetType;
}

export const eip712Asset = (assetId: string, assetType: EIP712AssetType): EIP712Asset => {
  return { assetId, assetType };
};

export interface EIP712ExecutionContext {
  executionPlanId: string;
  instructionSequenceNumber: string;
}

export const eip712ExecutionContext = (executionPlanId: string, instructionSequenceNumber: string): EIP712ExecutionContext => {
  return { executionPlanId, instructionSequenceNumber };
};

export interface EIP7127TradeDetails {
  executionContext: EIP712ExecutionContext;
}

export const eip712TradeDetails = (executionContext: EIP712ExecutionContext): EIP7127TradeDetails => {
  return { executionContext };
};

export interface EIP712TransactionDetails {
  operationId: string;
  transactionId: string;
}

export const eip712TransactionDetails = (operationId: string, transactionId: string): EIP712TransactionDetails => {
  return { operationId, transactionId };
};


export type EIP712Template = {
  type: 'EIP712'
  primaryType: string;
  domain: EIP712Domain;
  message: EIP712Message;
  types: EIP712Types
  hash: string
};


export interface EIP712ReceiptMessage extends EIP712Message {
  id: string,
  operationType: string,
  source: EIP712Source,
  destination: EIP712Destination,
  asset: EIP712Asset,
  quantity: string,
  tradeDetails: EIP7127TradeDetails,
  transactionDetails: EIP712TransactionDetails
}

export const newPrimarySaleMessage = (nonce: string, buyer: EIP712FinId, issuer: EIP712FinId, asset: EIP712Term, settlement: EIP712Term): EIP712PrimarySaleMessage => {
  return { nonce, buyer, issuer, asset, settlement };
};

export const newBuyingMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term): EIP712BuyingMessage => {
  return { nonce, buyer, seller, asset, settlement };
};

export const newSellingMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term): EIP712SellingMessage => {
  return { nonce, buyer, seller, asset, settlement };
};

export const newRedemptionMessage = (nonce: string, issuer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term): EIP712RedemptionMessage => {
  return { nonce, issuer, seller, asset, settlement };
};

export const newTransferMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term): EIP712TransferMessage => {
  return { nonce, buyer, seller, asset };
};

export const newPrivateOfferMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term): EIP712PrivateOfferMessage => {
  return { nonce, buyer, seller, asset, settlement };
};

export const newLoanMessage = (nonce: string, borrower: EIP712FinId, lender: EIP712FinId, asset: EIP712Term, settlement: EIP712Term, loanTerms: EIP712LoanTerms): EIP712LoanMessage => {
  return { nonce, borrower, lender, asset, settlement, loanTerms };
};

export const newReceiptMessage = (id: string, operationType: string, source: EIP712Source, destination: EIP712Destination, asset: EIP712Asset, quantity: string, tradeDetails: EIP7127TradeDetails, transactionDetails: EIP712TransactionDetails): EIP712ReceiptMessage => {
  return { id, operationType, source, destination, asset, quantity, tradeDetails, transactionDetails };
};


export const newInvestmentMessage = (
  primaryType: PrimaryType,
  nonce: string,
  buyerFinId: string,
  sellerFinId: string,
  asset: EIP712Term,
  settlement: EIP712Term,
  loan: EIP712LoanTerms | undefined = undefined,
): { message: EIP712Message, types: EIP712Types } => {
  let message: EIP712Message;
  let types: EIP712Types;
  switch (primaryType) {
    case PrimaryType.PrimarySale:
      types = PRIMARY_SALE_TYPES;
      message = newPrimarySaleMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Buying:
      types = BUYING_TYPES;
      message = newBuyingMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Selling:
      types = SELLING_TYPES;
      message = newSellingMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Redemption:
      types = REDEMPTION_TYPES;
      message = newRedemptionMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Transfer:
      types = TRANSFER_TYPES;
      message = newTransferMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset);
      break;
    case PrimaryType.PrivateOffer:
      types = PRIVATE_OFFER_TYPES;
      message = newPrivateOfferMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Loan:
      types = LOAN_TYPES;
      if (!loan) {
        throw new ValidationError('Loan terms are required for loan intent');
      }
      message = newLoanMessage(nonce, finId(sellerFinId), finId(buyerFinId), asset, settlement, loan);
      break;
    default:
      throw new ValidationError(`Unknown primary type: ${primaryType}`);
  }
  return { message, types };
};

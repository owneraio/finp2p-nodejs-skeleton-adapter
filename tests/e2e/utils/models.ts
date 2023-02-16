export interface CreateOwnerProfileRequest {
  publicKey: string;
  signature: string;
}

export interface ProfileOperation extends Operation {
  error?: any;
  response?: IdResponse;
}

export interface IdResponse {
  id: string;
}

export interface CreateDepositRequest {
  profileId: string;
  account: DepositAccount;
  amount: string;
  details?: Record<string, any>;
}

export interface PaymentError {
  code: number;
  message: string;
}

export interface Operation {
  cid: string;
  isCompleted: boolean;
}

export interface CreateDepositResponse extends Operation {
  error?: PaymentError;
  response?: DepositOperationResponse;
}

export interface FinIdAccount {
  type: "finId";
  finId: string;
  orgId: string;
}

export interface FinP2PAsset {
  type: "finp2p";
  resourceId: string;
}

export interface FiatAsset {
  type: "fiat";
  code: string;
}

export interface CryptocurrencyAsset {
  type: "cryptocurrency";
  code: string;
}

export interface CustomAsset {
  type: "custom";
}

export declare type DepositAccount = {
  asset: FinP2PAsset | FiatAsset | CryptocurrencyAsset | CustomAsset;
  account: FinIdAccount;
};

export interface DepositInstruction {
  operationId: string;
  depositInstruction: {
    account: DepositAccount;
    description: string;
    details?: Record<string, any>;
  };
}

export interface DepositOperationResponse {
  depositInstruction?: DepositInstruction;
}

// -----------------------------------

export interface Collateral {
  isin: string;
  securityName: string;
  ccy: string;
  compositeRating: string;
  quantity: string;
  accruedInterest: string;
  priceApplied: string;
  marginPercentage: string;
  marginalValue: string;
  exchangeRate: string;
  collateralValue: string;
}

export interface CollateralDetails {
  collaterals: Collateral[];
}

export interface CollateralIssuanceResult {
  assetId: string;
  assetName: string;
  collateralValue: string;
}
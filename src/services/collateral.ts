
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
  issuer: {
    profileId: string;
    finId: string;
  },
  denomination: {
    type: string;
    code: string;
  };
  collaterals: Collateral[];
  exposureAmount: string;
}

export interface CollateralIssuanceResult {
  assetId: string;
  assetName: string;
  collateralValue: string;
}
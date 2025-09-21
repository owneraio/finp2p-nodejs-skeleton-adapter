

export type AssetGroup = {
  nonce: string,
  operation: string,
  source?: {
    type: string
    finId: string,
  };
  destination?: {
    type: string
    finId: string,
  };
  quantity: string,
  asset: {
    assetType: string
    assetId: string,
  };
};

export type SettlementGroup = {
  asset: {
    assetType: string
    assetId: string,
  };
  source?: {
    type: string
    finId: string;
  }
  destination?: {
    type: string
    finId: string;
  }
  quantity: string;
  expiry: number;
};


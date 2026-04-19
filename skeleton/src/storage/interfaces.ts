export interface Account {
  finId: string;
  fields: Record<string, string>;
}

export interface Asset {
  id: string;
  token_standard: string;
  contract_address: string;
  decimals: number;
  created_at: Date;
  updated_at: Date;
}

export interface AccountStore {
  getAccounts(finIds?: string[]): Promise<Account[]>;
  getByFieldValue(fieldName: string, value: string): Promise<Account[]>;
  saveAccount(finId: string, fields: Record<string, string>): Promise<Account>;
  deleteAccount(finId: string, fieldName?: string): Promise<void>;
}

export interface AssetStore {
  getAsset(assetId: string): Promise<Asset | undefined>;
  saveAsset(asset: Omit<Asset, 'created_at' | 'updated_at'>): Promise<Asset>;
}

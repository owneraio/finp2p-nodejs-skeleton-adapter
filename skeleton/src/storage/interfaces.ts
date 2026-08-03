import { NetworkAccount } from '../models';

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

/**
 * One row per BINDING, not per address. The same address can legitimately be
 * bound many times (omnibus: one shared wallet whitelisted for many investors
 * router-side); the finId tells the bindings apart per investor.
 */
export interface NetworkAccountRow {
  /** LA-assigned account identifier (used by `DELETE /accounts/{accountId}`). */
  accountId: string;
  /** Idempotency-Key of the create request; undefined when the header was absent. */
  idempotencyKey: string | undefined;
  organizationId: string;
  assetId: string;
  /** Investor finId. Should not be optional — the router marks it optional in
   *  the OAS "for backward compatibility" only; undefined = legacy router. */
  finId: string | undefined;
  account: NetworkAccount;
}

export interface NetworkAccountStore {
  insert(row: NetworkAccountRow): Promise<NetworkAccountRow>;
  /** Transport-level retry lookup: hits only when the router re-sends the same request. */
  getByIdempotencyKey(idempotencyKey: string): Promise<NetworkAccountRow | undefined>;
  /** Delete by LA-assigned account id, returning the removed row (undefined if absent). */
  remove(accountId: string): Promise<NetworkAccountRow | undefined>;
}

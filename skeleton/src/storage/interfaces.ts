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
 * One binding per (organizationId, assetId, finId) — enforced by a unique
 * index. The same address can still be bound many times (omnibus: one shared
 * wallet whitelisted for many investors router-side); the finId tells the
 * bindings apart per investor.
 */
export interface NetworkAccountRow {
  /** LA-assigned account identifier (used by `DELETE /accounts/{accountId}`). */
  accountId: string;
  /** Idempotency-Key of the create request, kept for tracing only; replay
   *  lookup is by finId. Undefined when the header was absent. */
  idempotencyKey: string | undefined;
  organizationId: string;
  assetId: string;
  finId: string;
  account: NetworkAccount;
}

export interface NetworkAccountStore {
  insert(row: NetworkAccountRow): Promise<NetworkAccountRow>;
  getByFinId(organizationId: string, assetId: string, finId: string): Promise<NetworkAccountRow | undefined>;
  remove(accountId: string): Promise<NetworkAccountRow | undefined>;
}

export interface Account {
  finId: string;
  fields: Record<string, string>;
}

export interface AccountStore {
  getAccounts(finIds?: string[]): Promise<Account[]>;
  getByFieldValue(fieldName: string, value: string): Promise<Account[]>;
  saveAccount(finId: string, fields: Record<string, string>): Promise<Account>;
  deleteAccount(finId: string, fieldName?: string): Promise<void>;
}

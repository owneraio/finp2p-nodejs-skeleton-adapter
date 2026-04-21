import crypto from 'node:crypto';

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function extractOrgId(resourceId: string): string {
  const parts = resourceId.split(':');
  if (parts.length !== 3) {
    throw new Error(`Invalid resourceId format: ${resourceId}`);
  }
  return parts[0];
}

export function hexNonce(size = 16): string {
  return crypto.randomBytes(size).toString('hex');
}

export function generateNonce(): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.fill(crypto.randomBytes(24), 0, 24);
  const t = BigInt(Math.floor(Date.now() / 1000));
  buffer.writeBigInt64BE(t, 24);
  return buffer;
}

export type FinIdAccountRef = {
  type: 'finId';
  finId: string;
  orgId: string;
  custodian: { orgId: string };
};

export type CryptoWalletAccountRef = {
  type: 'cryptoWallet';
  address: string;
};

export type AccountRef = FinIdAccountRef | CryptoWalletAccountRef;

export function finIdAccount(finId: string, orgId: string, custodianOrgId: string): FinIdAccountRef {
  return { type: 'finId', finId, orgId, custodian: { orgId: custodianOrgId } };
}

export function settlementAccount(finId: string, orgId: string, custodianOrgId: string, cryptoAddress?: string): AccountRef {
  if (cryptoAddress) {
    return { type: 'cryptoWallet', address: cryptoAddress };
  }
  return finIdAccount(finId, orgId, custodianOrgId);
}

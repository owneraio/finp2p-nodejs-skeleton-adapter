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

/**
 * Normalize a base URL: prepend `http://` if no scheme is present.
 * Operators frequently set FINP2P_ADDRESS to `host:port` or a bare hostname —
 * without a scheme, `fetch` rejects with "unknown scheme". Default to plain
 * http so those configurations keep working.
 */
export function normalizeBaseUrl(url: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    return url;
  }
  return `http://${url}`;
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

export type AccountRef = { type: string; [key: string]: unknown };

export function finIdAccount(finId: string, orgId: string, custodianOrgId: string): AccountRef {
  return { type: 'finId', finId, orgId, custodian: { orgId: custodianOrgId } };
}

export function settlementAccount(finId: string, orgId: string, custodianOrgId: string, cryptoAddress?: string): AccountRef {
  if (cryptoAddress) {
    return { type: 'cryptoWallet', address: cryptoAddress };
  }
  return finIdAccount(finId, orgId, custodianOrgId);
}

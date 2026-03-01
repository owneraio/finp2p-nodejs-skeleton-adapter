import * as crypto from 'crypto';
import * as fs from 'fs';

export interface FinP2PAuthConfig {
  orgId: string;
  finApiUrl: string;
  finApiOssUrl: string;
  auth: {
    key: string;
    private: { raw: string };
    secret: { raw: string; type: number };
  };
}

/**
 * Create a JWT token resolver for FinP2P API authentication.
 *
 * The FinP2P API expects: { alg } header + { aud, apiKey, nonce, iat, exp } payload.
 * Secret type 2 = RSA (RS256), type 1 = HMAC (HS256).
 */
export function createAuthTokenResolver(orgId: string, auth: FinP2PAuthConfig['auth']): () => string {
  const apiKey = auth.key;
  const secretType = auth.secret?.type ?? 1;
  const signingKey = secretType === 2 ? auth.private.raw : (auth.secret?.raw ?? auth.private.raw);
  const algorithm = secretType === 2 ? 'RS256' : 'HS256';

  return () => {
    const now = Math.floor(Date.now() / 1000);

    // Nonce: 24 random bytes + 8-byte timestamp
    const nonceBuf = Buffer.alloc(32);
    nonceBuf.fill(crypto.randomBytes(24), 0, 24);
    nonceBuf.writeBigInt64BE(BigInt(now), 24);
    const nonce = nonceBuf.toString('hex');

    const header = JSON.stringify({ alg: algorithm });
    const payload = JSON.stringify({ aud: orgId, apiKey, nonce, iat: now, exp: now + 30 });
    const body = `${Buffer.from(header).toString('base64url')}.${Buffer.from(payload).toString('base64url')}`;

    let signature: string;
    if (algorithm === 'RS256') {
      signature = crypto.createSign('RSA-SHA256').update(body).sign(signingKey).toString('base64url');
    } else {
      signature = crypto.createHmac('sha256', signingKey).update(body).digest('base64url');
    }
    return `${body}.${signature}`;
  };
}

export function loadAuthFile(filePath: string): FinP2PAuthConfig {
  const content = fs.readFileSync(filePath, 'utf-8');
  const config = JSON.parse(content) as FinP2PAuthConfig;
  if (!config.auth?.key || !config.auth?.private?.raw) {
    throw new Error(`Auth file ${filePath}: incomplete (missing key or private key)`);
  }
  return config;
}

import * as secp256k1 from 'secp256k1';
import * as crypto from 'crypto';

export const ASSET = 102;

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const createCrypto = (): { private: Buffer, public: Buffer } => {
  // generate privKey
  let privKey;
  do {
    privKey = crypto.randomBytes(32);
  } while (!secp256k1.privateKeyVerify(privKey));

  // get the public key in a compressed format
  const pubKey = secp256k1.publicKeyCreate(privKey, true);
  return { private: privKey, public: Buffer.from(pubKey) };
};

export const generateNonce = () => {
  const buffer = Buffer.alloc(32);
  const randomBytes = crypto.randomBytes(24);

  // @ts-ignore
  buffer.fill(randomBytes, 0, 24);

  const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
  const t = BigInt(nowEpochSeconds);
  buffer.writeBigInt64BE(t, 24);

  return buffer;
};

export const randomResourceId = (orgId: string, resourceType: number) => {
  return `${orgId}:${resourceType}:${generateId()}`;
};

export function generateId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

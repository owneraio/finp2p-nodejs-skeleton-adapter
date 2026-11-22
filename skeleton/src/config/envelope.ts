// Envelope encryption of one secret value for the store (at rest): AES-256-GCM
// for the data, RSA-OAEP (SHA-256) for the AES key.
import { createCipheriv, createDecipheriv, createPublicKey, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { Sealer } from './interfaces';
import { SEAL_ALG, SealedValue } from './types';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const b64 = (b: Buffer): string => b.toString('base64');
const fromB64 = (s: string): Buffer => Buffer.from(s, 'base64');

/** Seal `plain` for the holder of `publicKeySpki` (base64 DER). Needs no private key. */
export function sealWithPublicKey(publicKeySpki: string, kid: string, plain: string): SealedValue {
  const key = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const wrappedKey = publicEncrypt({
    key: createPublicKey({ key: fromB64(publicKeySpki), format: 'der', type: 'spki' }),
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, key);
  return { enc: SEAL_ALG, kid, wrappedKey: b64(wrappedKey), iv: b64(iv), ciphertext: b64(body) };
}

/** Open a sealed value: unwrap the AES key through the sealer, then AES-GCM decrypt locally. */
export async function openSealed(sealer: Sealer, sealed: SealedValue): Promise<string> {
  if (sealed.enc !== SEAL_ALG) throw new Error(`unsupported envelope: ${sealed.enc}`);
  const key = await sealer.unwrapKey(fromB64(sealed.wrappedKey), sealed.kid);
  if (key.length !== KEY_BYTES) throw new Error('unwrapped key has the wrong size');
  const iv = fromB64(sealed.iv);
  const body = fromB64(sealed.ciphertext);
  if (iv.length !== IV_BYTES || body.length < TAG_BYTES) throw new Error('malformed envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  const out = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
  key.fill(0);
  return out.toString('utf8');
}

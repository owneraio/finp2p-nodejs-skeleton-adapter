// Compact JWS helpers for the wizard contract (ES256 only). Every parser is strict:
// canonical base64url, UTF-8 without BOM, JSON objects only.
import { createHash, KeyObject, sign, verify } from 'node:crypto';

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const COMPACT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const P1363_SIGNATURE_BYTES = 64;

export type JsonObject = Record<string, unknown>;

export const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

export const isPlainObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const sha256Hex = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

export const b64urlEncode = (bytes: Uint8Array | string): string => Buffer.from(bytes).toString('base64url');

/** Decodes only text that re-encodes to itself: Node's decoder skips stray characters and leftover bits. */
export function b64urlDecodeStrict(text: unknown): Buffer | null {
  if (typeof text !== 'string' || !BASE64URL.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : null;
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function parseJsonObject(bytes: Uint8Array): JsonObject | null {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return null;
  }
  if (text.charCodeAt(0) === 0xfeff) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

export interface CompactParts {
  header: JsonObject;
  payloadBytes: Buffer;
  signature: Buffer;
  signingInput: string;
}

export function parseCompact(compact: unknown): CompactParts | null {
  if (typeof compact !== 'string' || !COMPACT.test(compact)) return null;
  const [headerB64, payloadB64, signatureB64] = compact.split('.');
  const headerBytes = b64urlDecodeStrict(headerB64);
  const payloadBytes = b64urlDecodeStrict(payloadB64);
  const signature = b64urlDecodeStrict(signatureB64);
  if (!headerBytes || !payloadBytes || !signature) return null;
  const header = parseJsonObject(headerBytes);
  if (!header) return null;
  return { header, payloadBytes, signature, signingInput: `${headerB64}.${payloadB64}` };
}

export function signCompact(header: JsonObject, payloadBytes: Uint8Array, privateKey: KeyObject): string {
  const signingInput = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(payloadBytes)}`;
  const signature = sign('sha256', Buffer.from(signingInput, 'ascii'), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64urlEncode(signature)}`;
}

export function verifyEs256(signingInput: string, signature: Uint8Array, publicKey: KeyObject): boolean {
  if (signature.length !== P1363_SIGNATURE_BYTES) return false;
  try {
    return verify('sha256', Buffer.from(signingInput, 'ascii'), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    return false;
  }
}

export const isP256Key = (key: KeyObject): boolean =>
  key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';

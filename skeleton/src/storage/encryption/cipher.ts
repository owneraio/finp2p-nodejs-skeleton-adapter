import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { DerivedKeys, Keyring } from './keyring';

// v1.<r|d>.<kid>.<base64url(iv || ct || tag)>
// d: same plaintext → same ciphertext, leaks equality. aad binds the value to its column.

export type Mode = 'random' | 'deterministic';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MODE_TAG: Record<Mode, string> = { random: 'r', deterministic: 'd' };
const TAG_MODE: Record<string, Mode> = { r: 'random', d: 'deterministic' };
const FORMAT = /^v1\.([rd])\.([0-9a-f]{8})\.([A-Za-z0-9_-]+)$/;

export interface Parsed {
  version: string;
  mode: Mode;
  kid: string;
  body: Buffer;
}

export function parse(stored: string): Parsed | undefined {
  const m = FORMAT.exec(stored);
  if (!m) return undefined;
  const body = Buffer.from(m[3], 'base64url');
  if (body.length < IV_BYTES + TAG_BYTES) return undefined;
  return { version: VERSION, mode: TAG_MODE[m[1]], kid: m[2], body };
}

export const isEncrypted = (value: string): boolean => parse(value) !== undefined;

function deterministicIv(key: DerivedKeys, plain: Buffer, aad: Buffer): Buffer {
  return createHmac('sha256', key.deterministicIv)
    .update(aad).update(Buffer.from([0])).update(plain)
    .digest()
    .subarray(0, IV_BYTES);
}

export function encryptWith(key: DerivedKeys, mode: Mode, plain: string, aad: string): string {
  const plainBuf = Buffer.from(plain, 'utf8');
  const aadBuf = Buffer.from(aad, 'utf8');
  const iv = mode === 'random' ? randomBytes(IV_BYTES) : deterministicIv(key, plainBuf, aadBuf);
  const cipher = createCipheriv('aes-256-gcm', mode === 'random' ? key.random : key.deterministic, iv);
  cipher.setAAD(aadBuf);
  const body = Buffer.concat([iv, cipher.update(plainBuf), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${MODE_TAG[mode]}.${key.kid}.${body.toString('base64url')}`;
}

export function encrypt(keyring: Keyring, mode: Mode, plain: string, aad: string): string {
  return encryptWith(keyring.current, mode, plain, aad);
}

export function decrypt(keyring: Keyring, stored: string, aad: string): string {
  const parsed = parse(stored);
  if (!parsed) throw new Error('value is not in the encrypted-at-rest format');
  const key = keyring.find(parsed.kid);
  if (!key) throw new Error(`no key in keyring for kid ${parsed.kid}; add it to ${'DB_ENCRYPTION_KEYS'} to read this value`);
  const { body } = parsed;
  const iv = body.subarray(0, IV_BYTES);
  const tag = body.subarray(body.length - TAG_BYTES);
  const ct = body.subarray(IV_BYTES, body.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', parsed.mode === 'random' ? key.random : key.deterministic, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    // OpenSSL wording varies by Node version
    throw new Error(`${aad}: ciphertext failed authentication (wrong key, modified data, or moved between columns)`);
  }
}

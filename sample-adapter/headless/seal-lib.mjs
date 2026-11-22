// Seal a secret for the adapter in the browser or in node (>= 20): a fresh
// AES-256-GCM key encrypts the value, the adapter's RSA public key (RSA-OAEP,
// SHA-256) wraps that key. Output = SealedValue of adapter-config/2. No imports,
// WebCrypto only, so no proxy between the browser and the adapter sees plaintext.

export const SEAL_ALG = 'RSA-OAEP-256+A256GCM';

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('WebCrypto (crypto.subtle) is not available; use https or node >= 20');
  return s;
};

export function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 1) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

export function fromBase64(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** `encryptionInfo` = descriptor.encryption from GET /config. Returns a CryptoKey that can wrap AES keys. */
export async function importAdapterKey(encryptionInfo) {
  if (!encryptionInfo || encryptionInfo.alg !== SEAL_ALG) {
    throw new Error(`unsupported encryption alg: ${encryptionInfo && encryptionInfo.alg}`);
  }
  return subtle().importKey(
    'spki',
    fromBase64(encryptionInfo.publicKey),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['wrapKey'],
  );
}

/** Seal `plaintext` (string) for the adapter. Returns a SealedValue ready for POST /config/apply. */
export async function sealSecret(encryptionInfo, plaintext, rsaKey) {
  const s = subtle();
  const wrapWith = rsaKey || await importAdapterKey(encryptionInfo);
  const aesKey = await s.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await s.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(String(plaintext)));
  const wrappedKey = await s.wrapKey('raw', aesKey, wrapWith, { name: 'RSA-OAEP' });
  return {
    enc: SEAL_ALG,
    kid: encryptionInfo.kid,
    wrappedKey: toBase64(wrappedKey),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

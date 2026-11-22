// Tiny RSA sealer for tests: key pair in memory, kid 'test'.
import { constants, generateKeyPairSync, KeyObject, privateDecrypt } from 'node:crypto';
import { Sealer } from '../../../src/config/interfaces';

export class TestSealer implements Sealer {
  readonly provider = 'local' as const;

  private readonly privateKey: KeyObject;

  private readonly spki: string;

  constructor(readonly keyId: string = 'test') {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.spki = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  }

  async kid(): Promise<string> {
    return this.keyId;
  }

  async publicKey(): Promise<string> {
    return this.spki;
  }

  async unwrapKey(wrappedKey: Buffer, kid: string): Promise<Buffer> {
    if (kid !== this.keyId) throw new Error('unknown kid');
    return privateDecrypt({
      key: this.privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    }, wrappedKey);
  }
}

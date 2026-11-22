import { createHash, hkdfSync, randomBytes } from 'node:crypto';

// DB_ENCRYPTION_KEY_CURRENT encrypts; it and DB_ENCRYPTION_KEYS_PREVIOUS="old1,old2" decrypt.

export const MASTER_KEY_BYTES = 32;
const SUBKEY_BYTES = 32;
const KID_HEX_CHARS = 8;
const INFO_PREFIX = 'finp2p-adapter/at-rest/v1/';

export const ENV_KEY_CURRENT = 'DB_ENCRYPTION_KEY_CURRENT';
export const ENV_KEYS_PREVIOUS = 'DB_ENCRYPTION_KEYS_PREVIOUS';
export const ENV_SALT = 'DB_ENCRYPTION_SALT';
const SEPARATOR = /[,;]/;

export interface DerivedKeys {
  readonly kid: string;
  readonly random: Buffer;
  readonly deterministic: Buffer;
  readonly deterministicIv: Buffer;
}

function subkey(master: Buffer, salt: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, salt, `${INFO_PREFIX}${purpose}`, SUBKEY_BYTES));
}

function derive(master: Buffer, salt: string): DerivedKeys {
  if (master.length !== MASTER_KEY_BYTES) {
    throw new Error(`encryption key must be ${MASTER_KEY_BYTES} bytes, got ${master.length}`);
  }
  return {
    kid: createHash('sha256').update(master).digest('hex').slice(0, KID_HEX_CHARS),
    random: subkey(master, salt, 'random'),
    deterministic: subkey(master, salt, 'deterministic'),
    deterministicIv: subkey(master, salt, 'deterministic-iv'),
  };
}

export function parseMasterKey(raw: string): Buffer {
  const text = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (buf.length !== MASTER_KEY_BYTES) {
    throw new Error(`encryption key must decode to ${MASTER_KEY_BYTES} bytes (base64 or hex), got ${buf.length}`);
  }
  return buf;
}

export class Keyring {
  private readonly keys: readonly DerivedKeys[];

  // salt: deployments sharing a master must not produce equal ciphertexts
  constructor(masters: Buffer[], salt = '') {
    if (masters.length === 0) throw new Error('Keyring needs at least one key');
    const keys = masters.map((m) => derive(m, salt));
    const kids = new Set(keys.map((k) => k.kid));
    if (kids.size !== keys.length) throw new Error('Keyring has duplicate keys');
    this.keys = keys;
  }

  get current(): DerivedKeys {
    return this.keys[0];
  }

  find(kid: string): DerivedKeys | undefined {
    return this.keys.find((k) => k.kid === kid);
  }

  all(): readonly DerivedKeys[] {
    return this.keys;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): Keyring {
    const current = env[ENV_KEY_CURRENT]?.trim();
    if (!current) {
      throw new Error(`${ENV_KEY_CURRENT} is not set. Generate one with: openssl rand -base64 32`);
    }
    if (SEPARATOR.test(current)) {
      throw new Error(`${ENV_KEY_CURRENT} holds exactly one key; older keys go to ${ENV_KEYS_PREVIOUS}`);
    }
    const previous = (env[ENV_KEYS_PREVIOUS] ?? '')
      .split(SEPARATOR)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return new Keyring([current, ...previous].map(parseMasterKey), env[ENV_SALT] ?? '');
  }

  static generateKey(): string {
    return randomBytes(MASTER_KEY_BYTES).toString('base64');
  }
}

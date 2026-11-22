// Holds the adapter config (adapter-config/3): 1 document with `ledgers` (by
// CAIP-2) and `custody`. POST merges a patch into the active config, checks
// it, applies it through the adapter's ConfigHandler when a value changed and
// stores it. A failed apply re-applies the previous config. Mutations run one
// at a time through a promise queue. Plaintext secrets live only in memory.
import { logger as defaultLogger } from '../helpers/logger';
import { openSealed, sealWithPublicKey } from './envelope';
import {
  ConfigHandler, ConfigStore, Sealer, StoredConfig, StoredValue,
} from './interfaces';
import {
  AdapterConfig, ApplyResult, CONFIG_KEY_RE, ConfigDocument, ConfigError, ConfigPatch, ConfigScalar, ConfigSection,
  ConfigState, ERROR_CODES, isSealedValue, LEDGER_ID_RE, MaskedSection, PROTOCOL, SEAL_ALG, SealedValue,
} from './types';

export const APPLY_TIMEOUT_MS = 120_000;

/**
 * Pseudo kid used when the runtime has no sealer: the "envelope" is only
 * base64 of the plaintext. Dev only; never use without a sealer in production.
 */
export const PLAIN_KID = 'plain';

export interface ConfigLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ConfigRuntimeOptions {
  version: string;                  // the adapter's config version, printed by GET /config
  adapter: { id: string; version: string };
  secretKeys: readonly string[];    // keys shown as { set: true } and sealed at rest, in every section
  handler: ConfigHandler;
  store?: ConfigStore;              // undefined = memory only
  sealer?: Sealer;                  // seals secrets at rest; undefined = the plain pseudo envelope (dev only)
  logger?: ConfigLogger;
  applyTimeoutMs?: number;
}

/** A request refused before its values are looked at: 400 (shape) or 409 (another config version). */
export class ConfigRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ConfigRequestError';
  }
}

const skeletonLogger: ConfigLogger = {
  info: (m, meta) => defaultLogger.info(m, meta),
  warn: (m, meta) => defaultLogger.warning(m, meta),
  error: (m, meta) => defaultLogger.error(m, meta),
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v: unknown): v is ConfigScalar => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** JSON with object keys sorted, so key order does not count as a change. */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (
  isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x
));

/** The message with URL credentials and every secret value replaced by ***, longest first. */
export const redact = (message: string, secrets: string[]): string => {
  let out = message.replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//***@');
  for (const s of [...secrets].filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(s).join('***');
  return out;
};

const withTimeout = async <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const sections = <V>(doc: { ledgers: Record<string, Record<string, V>>; custody?: Record<string, V> }): Array<[string, Record<string, V>]> => [
  ...Object.entries(doc.ledgers).map(([id, sec]): [string, Record<string, V>] => [`ledgers.${id}`, sec]),
  ...(doc.custody ? [['custody', doc.custody] as [string, Record<string, V>]] : []),
];

export class ConfigRuntime {
  private active: AdapterConfig | undefined;   // plaintext, memory only

  private stored: StoredConfig | undefined;    // as persisted, secrets sealed

  private state: ConfigState = 'unconfigured';

  private lastError: string | undefined;

  private revision = 0;

  private readonly secretKeys: Set<string>;

  private readonly log: ConfigLogger;

  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ConfigRuntimeOptions) {
    this.secretKeys = new Set(opts.secretKeys);
    this.log = opts.logger ?? skeletonLogger;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ---- read side ----

  /** The applied config (plaintext), undefined before the first apply. Read it, do not change it. */
  current(): AdapterConfig | undefined {
    return this.active;
  }

  /** The applied section of one ledger (CAIP-2). */
  ledger(id: string): ConfigSection | undefined {
    return this.active?.ledgers[id];
  }

  ready(): boolean {
    return this.state === 'configured';
  }

  /** GET /config: the config version, the state and the configured values, secrets as { set: true }. */
  describe(): Promise<ConfigDocument> {
    const src = this.active ?? this.stored;
    const ledgers: Record<string, MaskedSection> = {};
    for (const [id, sec] of Object.entries(src?.ledgers ?? {})) ledgers[id] = this.mask(sec);
    return Promise.resolve({
      protocol: PROTOCOL,
      version: this.opts.version,
      adapter: this.opts.adapter,
      state: this.state,
      revision: this.revision,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ledgers,
      ...(src?.custody ? { custody: this.mask(src.custody) } : {}),
    });
  }

  private mask(section: Record<string, StoredValue>): MaskedSection {
    const out: MaskedSection = {};
    for (const [key, value] of Object.entries(section)) {
      out[key] = this.secretKeys.has(key) || isSealedValue(value) ? { set: true } : value;
    }
    return out;
  }

  // ---- apply ----

  /**
   * POST /config. Throws ConfigRequestError for a malformed body (400) or a
   * patch made for another config version (409). Otherwise answers with a
   * result: invalid values and refused applies have `ok: false`.
   */
  apply(body: unknown, actor?: string): Promise<ApplyResult> {
    return this.enqueue(async () => {
      const patch = this.patchOf(body);
      const { config, errors } = this.merge(this.base(), patch);
      if (errors.length > 0) return this.result(false, false, errors);
      if (this.state === 'configured' && this.active && canonical(this.active) === canonical(config)) {
        return this.result(true, false, []);
      }

      const secrets = this.secretValues(config);
      const ms = this.opts.applyTimeoutMs ?? APPLY_TIMEOUT_MS;
      if (this.opts.handler.validate) {
        let found: ConfigError[];
        try {
          found = await withTimeout(this.opts.handler.validate(clone(config)), ms, 'validate');
        } catch (e) {
          found = [{ path: '', code: ERROR_CODES.invalid, message: errMsg(e) }];
        }
        if (found.length > 0) return this.result(false, false, found.map((e) => ({ ...e, message: redact(e.message, secrets) })));
      }

      const previous = this.active;
      try {
        await withTimeout(this.opts.handler.apply(clone(config), previous && clone(previous)), ms, 'apply');
      } catch (e) {
        return this.refuse(previous, config, redact(errMsg(e), secrets), 'config apply failed');
      }
      let stored: StoredConfig;
      try {
        stored = await this.persist(config, actor);
      } catch (e) {
        return this.refuse(previous, config, `cannot store the config: ${redact(errMsg(e), secrets)}`, 'config store failed');
      }
      this.active = config;
      this.stored = stored;
      this.revision = stored.revision;
      this.state = 'configured';
      this.lastError = undefined;
      this.log.info('config applied', { revision: this.revision, ledgers: Object.keys(config.ledgers), custody: !!config.custody, actor });
      return this.result(true, true, []);
    });
  }

  /** The values a patch merges into: the active config, else the non-secret values of the stored one, else nothing. */
  private base(): AdapterConfig {
    if (this.active) return this.active;
    if (!this.stored) return { ledgers: {} };
    const plain = (sec: Record<string, StoredValue>): ConfigSection => Object.fromEntries(
      Object.entries(sec).filter(([, v]) => !isSealedValue(v)),
    ) as ConfigSection;
    const ledgers: Record<string, ConfigSection> = {};
    for (const [id, sec] of Object.entries(this.stored.ledgers)) ledgers[id] = plain(sec);
    return { ledgers, ...(this.stored.custody ? { custody: plain(this.stored.custody) } : {}) };
  }

  private patchOf(body: unknown): ConfigPatch {
    if (!isObject(body)) throw new ConfigRequestError(400, ERROR_CODES.badRequest, 'body must be a JSON object');
    for (const key of Object.keys(body)) {
      if (key !== 'version' && key !== 'ledgers' && key !== 'custody') {
        throw new ConfigRequestError(400, ERROR_CODES.badRequest, `unknown section ${key}: expected version, ledgers, custody`);
      }
    }
    if (body.version !== undefined && body.version !== this.opts.version) {
      throw new ConfigRequestError(409, ERROR_CODES.versionMismatch, `config version ${String(body.version)} does not match ${this.opts.version}`);
    }
    if (body.ledgers !== undefined && !isObject(body.ledgers)) {
      throw new ConfigRequestError(400, ERROR_CODES.badRequest, 'ledgers must be an object keyed by the ledger (CAIP-2)');
    }
    if (body.custody !== undefined && body.custody !== null && !isObject(body.custody)) {
      throw new ConfigRequestError(400, ERROR_CODES.badRequest, 'custody must be an object or null');
    }
    return body as ConfigPatch;
  }

  /** Omitted keeps; null or "" clears a key, a ledger or the custody section. A section left empty is dropped. */
  private merge(base: AdapterConfig, patch: ConfigPatch): { config: AdapterConfig; errors: ConfigError[] } {
    const config = clone(base);
    const errors: ConfigError[] = [];
    for (const [id, section] of Object.entries(patch.ledgers ?? {})) {
      const path = `ledgers.${id}`;
      if (!LEDGER_ID_RE.test(id)) {
        errors.push({ path, code: ERROR_CODES.badLedger, message: `${id} is not a ledger id (CAIP-2, e.g. eip155:1)` });
        continue;
      }
      if (section === null) {
        delete config.ledgers[id];
        continue;
      }
      if (!isObject(section)) {
        errors.push({ path, code: ERROR_CODES.type, message: `${path} must be an object or null` });
        continue;
      }
      const merged = this.mergeSection(config.ledgers[id] ?? {}, section, path, errors);
      if (Object.keys(merged).length > 0) config.ledgers[id] = merged;
      else delete config.ledgers[id];
    }
    if (patch.custody === null) {
      delete config.custody;
    } else if (patch.custody !== undefined) {
      const merged = this.mergeSection(config.custody ?? {}, patch.custody, 'custody', errors);
      if (Object.keys(merged).length > 0) config.custody = merged;
      else delete config.custody;
    }
    return { config, errors };
  }

  private mergeSection(base: ConfigSection, patch: Record<string, unknown>, path: string, errors: ConfigError[]): ConfigSection {
    const out = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      const at = `${path}.${key}`;
      if (!CONFIG_KEY_RE.test(key)) {
        errors.push({ path: at, code: ERROR_CODES.badKey, message: `${at} is not a valid key (letters, digits, _)` });
        continue;
      }
      if (value === null || value === '') {
        delete out[key];
        continue;
      }
      if (!isScalar(value)) {
        errors.push({ path: at, code: ERROR_CODES.type, message: `${at} must be a string, number or boolean` });
        continue;
      }
      out[key] = value;
    }
    return out;
  }

  /** The refused config stays out: the previous one is applied again (if any) and the result names the error. */
  private async refuse(previous: AdapterConfig | undefined, refused: AdapterConfig, message: string, what: string): Promise<ApplyResult> {
    this.log.error(what, { error: message });
    this.lastError = message;
    if (previous) {
      try {
        await withTimeout(this.opts.handler.apply(clone(previous), clone(refused)), this.opts.applyTimeoutMs ?? APPLY_TIMEOUT_MS, 'apply');
      } catch (e) {
        this.state = 'error';
        this.log.error('config rollback failed: the previous config is not active', { error: redact(errMsg(e), this.secretValues(previous)) });
      }
    }
    return this.result(false, false, [{ path: '', code: ERROR_CODES.applyFailed, message }]);
  }

  private result(ok: boolean, applied: boolean, errors: ConfigError[]): ApplyResult {
    return { ok, applied, revision: this.revision, state: this.state, errors };
  }

  private secretValues(config: AdapterConfig): string[] {
    const out: string[] = [];
    for (const [, sec] of sections(config)) {
      for (const [key, value] of Object.entries(sec)) if (this.secretKeys.has(key)) out.push(String(value));
    }
    return out;
  }

  // ---- secrets at rest ----

  private async persist(config: AdapterConfig, actor?: string): Promise<StoredConfig> {
    const sealSection = async (sec: ConfigSection): Promise<Record<string, StoredValue>> => {
      const out: Record<string, StoredValue> = {};
      for (const [key, value] of Object.entries(sec)) out[key] = this.secretKeys.has(key) ? await this.seal(String(value)) : value;
      return out;
    };
    const ledgers: StoredConfig['ledgers'] = {};
    for (const [id, sec] of Object.entries(config.ledgers)) ledgers[id] = await sealSection(sec);
    const doc = {
      version: this.opts.version,
      ledgers,
      ...(config.custody ? { custody: await sealSection(config.custody) } : {}),
      ...(actor ? { actor } : {}),
    };
    const revision = this.opts.store ? await this.opts.store.save(doc) : this.revision + 1;
    return { ...doc, revision };
  }

  private async seal(plain: string): Promise<SealedValue> {
    const { sealer } = this.opts;
    if (!sealer) {
      return { enc: SEAL_ALG, kid: PLAIN_KID, wrappedKey: '', iv: '', ciphertext: Buffer.from(plain, 'utf8').toString('base64') };
    }
    return sealWithPublicKey(await sealer.publicKey(), await sealer.kid(), plain);
  }

  private async open(path: string, sealed: SealedValue): Promise<string> {
    if (sealed.kid === PLAIN_KID) {
      // dev-only pseudo envelope: once a real sealer exists, never fall back to it
      if (this.opts.sealer) throw new Error(`${path} was stored without a sealer, apply it again`);
      return Buffer.from(sealed.ciphertext, 'base64').toString('utf8');
    }
    if (!this.opts.sealer) throw new Error(`${path} is sealed but this adapter has no sealer`);
    try {
      return await openSealed(this.opts.sealer, sealed);
    } catch (e) {
      throw new Error(`${path}: cannot open the sealed value (${errMsg(e)})`);
    }
  }

  private async openAll(doc: StoredConfig): Promise<AdapterConfig> {
    const openSection = async (path: string, sec: Record<string, StoredValue>): Promise<ConfigSection> => {
      const out: ConfigSection = {};
      for (const [key, value] of Object.entries(sec)) out[key] = isSealedValue(value) ? await this.open(`${path}.${key}`, value) : value;
      return out;
    };
    const ledgers: Record<string, ConfigSection> = {};
    for (const [id, sec] of Object.entries(doc.ledgers)) ledgers[id] = await openSection(`ledgers.${id}`, sec);
    return { ledgers, ...(doc.custody ? { custody: await openSection('custody', doc.custody) } : {}) };
  }

  // ---- boot ----

  /** Boot: apply the stored config. No validate. Never throws; a failure leaves state 'error'. */
  restore(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.opts.store) return;
      let doc: StoredConfig | undefined;
      try {
        doc = await this.opts.store.load();
      } catch (e) {
        this.state = 'error';
        this.lastError = `cannot load the stored config: ${errMsg(e)}`;
        this.log.error('config restore: cannot load', { error: errMsg(e) });
        return;
      }
      if (!doc) return;
      this.stored = doc;
      this.revision = doc.revision;
      if (doc.version !== this.opts.version) {
        this.log.warn('config restore: the config was stored under another version', { stored: doc.version, current: this.opts.version });
      }
      let config: AdapterConfig;
      try {
        config = await this.openAll(doc);
      } catch (e) {
        this.state = 'error';
        this.lastError = errMsg(e);
        this.log.error('config restore: cannot open the secrets', { error: this.lastError });
        return;
      }
      try {
        await withTimeout(this.opts.handler.apply(clone(config), undefined), this.opts.applyTimeoutMs ?? APPLY_TIMEOUT_MS, 'apply');
      } catch (e) {
        this.state = 'error';
        this.lastError = redact(errMsg(e), this.secretValues(config));
        this.log.error('config restore: apply failed', { error: this.lastError });
        return;
      }
      this.active = config;
      this.state = 'configured';
      this.lastError = undefined;
      this.log.info('config restored', { revision: doc.revision, ledgers: Object.keys(config.ledgers) });
    });
  }
}

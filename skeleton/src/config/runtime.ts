// Holds the configs of one adapter, one per (kind, id): merge -> validate ->
// store -> activate through the adapter's ConfigHandler. For kind 'network'
// the id is the ledger (CAIP-2), so an asset's ledger names its config and no
// asset binding exists. For kind 'account' the id is CAIP-10 (`<ledger>:<address>`),
// one config per investor wallet. Mutations run one at a time through a promise queue.
// Plaintext secrets live only in memory (ActiveConfig).
import { logger as defaultLogger } from '../helpers/logger';
import { openSealed, sealWithPublicKey } from './envelope';
import {
  ConfigHandler, ConfigRef, ConfigStore, Sealer, StoredConfig,
} from './interfaces';
import {
  errMsg, fieldIndex, pagesOfKind, sanitizeMessage, staticValidate, visibleFields, withDefaults,
} from './schema';
import {
  ACCOUNT_ID_RE, ActiveConfig, ApplyRequest, ApplyResult, CONFIG_ID_RE, CONFIG_KINDS, ConfigCheck, ConfigDescriptor, ConfigError,
  ConfigField, ConfigKind, ConfigPage, ConfigState, ConfigSummary, ConfigValues, DEFAULT_KIND, DescriptorValue,
  ERROR_CODES, PROTOCOL, RequestValues, SealedValue, SealedValues, SEAL_ALG,
  ValidateRequest, ValidationResult,
} from './types';

export const CHECK_TIMEOUT_MS = 10_000;
export const ACTIVATE_TIMEOUT_MS = 120_000;

/**
 * Pseudo kid used when the runtime has no sealer: the "envelope" is only
 * base64 of the plaintext. Dev only; never use without a sealer in production.
 */
export const PLAIN_KID = 'plain';

export interface ConfigLogger {
  info(message: string, meta?: Record<string, unknown>): unknown;
  warn(message: string, meta?: Record<string, unknown>): unknown;
  error(message: string, meta?: Record<string, unknown>): unknown;
}

export interface ConfigRuntimeOptions {
  adapter: { id: string; kind: string; version: string };
  pages: ConfigPage[];
  handler: ConfigHandler;
  store?: ConfigStore;              // undefined = memory only
  sealer?: Sealer;                  // seals secrets at rest; undefined = the plain pseudo envelope (dev only)
  logger?: ConfigLogger;
  checkTimeoutMs?: number;
  activateTimeoutMs?: number;
}

/** Problem the HTTP layer maps to a status code. */
export class ConfigRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly path: string = '',
  ) {
    super(message);
    this.name = 'ConfigRequestError';
  }
}

export interface MergeResult {
  values: ConfigValues;
  secrets: SealedValues;
  cleared: string[];
  /** Secrets that arrived in plaintext in this request (already known, no need to open). */
  plainSecrets: Record<string, string>;
  errors: ConfigError[];
}

export interface ConfigEntry {
  stored: StoredConfig;
  active?: ActiveConfig;
  state: ConfigState;
  lastError?: string;
}

/** Rejects after `ms`. `onLate` runs if `p` settles after the timeout fired (resources it built must be torn down). */
const withTimeout = <T>(p: Promise<T>, ms: number, what: string, onLate?: () => void): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      reject(new Error(`${what}: timeout after ${ms}ms`));
    }, ms);
    t.unref?.();
    const late = () => { if (timedOut) onLate?.(); };
    p.then((v) => { clearTimeout(t); resolve(v); late(); }, (e) => { clearTimeout(t); reject(e); late(); });
  });

const skeletonLogger: ConfigLogger = {
  info: (m, meta) => defaultLogger.info(m, meta),
  warn: (m, meta) => defaultLogger.warning(m, meta),
  error: (m, meta) => defaultLogger.error(m, meta),
};

const plainEnvelope = (plain: string): SealedValue => ({
  enc: SEAL_ALG, kid: PLAIN_KID, wrappedKey: '', iv: '', ciphertext: Buffer.from(plain, 'utf8').toString('base64'),
});

const codeOf = (e: unknown): unknown => (e as { code?: unknown })?.code;
const isNotFound = (e: unknown): boolean => codeOf(e) === ERROR_CODES.notFound;

export const refKey = (ref: ConfigRef): string => `${ref.kind}/${ref.id}`;
export const isConfigKind = (k: unknown): k is ConfigKind => typeof k === 'string' && (CONFIG_KINDS as readonly string[]).includes(k);

const EIP155 = 'eip155:';

/** Whether `id` names a config of `kind`: CAIP-10 for an account (lowercase on eip155), CONFIG_ID_RE otherwise. */
export const isConfigId = (kind: ConfigKind, id: unknown): id is string => {
  if (typeof id !== 'string') return false;
  if (kind !== 'account') return CONFIG_ID_RE.test(id);
  return ACCOUNT_ID_RE.test(id) && (!id.startsWith(EIP155) || id === id.toLowerCase());
};

/** The id of the account config of `address` on `ledger` (CAIP-2). An eip155 address is lowercased. */
export const accountConfigId = (ledger: string, address: string): string =>
  `${ledger}:${ledger.startsWith(EIP155) ? address.toLowerCase() : address}`;

const ID_RULES: Record<ConfigKind, string> = {
  network: 'id must be the ledger (CAIP-2, e.g. eip155:11155111)',
  custody: 'id must be a name (letters, digits, - _ . :)',
  account: 'id must be an account on a ledger (CAIP-10, e.g. eip155:1:0xab16...), lowercase on eip155',
};

/** Custody first (a network may need its custodian), accounts last (an account rides on its network). */
const RESTORE_ORDER: Record<ConfigKind, number> = { custody: 0, network: 1, account: 2 };

export class ConfigRuntime {
  private readonly entries = new Map<string, ConfigEntry>();

  /** kind -> page subset, field index */
  private readonly kinds: Record<ConfigKind, { pages: ConfigPage[]; fields: Map<string, ConfigField> }>;

  private readonly log: ConfigLogger;

  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ConfigRuntimeOptions) {
    this.kinds = Object.fromEntries(CONFIG_KINDS.map((k) => {
      const pages = pagesOfKind(opts.pages, k);
      return [k, { pages, fields: fieldIndex(pages) }];
    })) as ConfigRuntime['kinds'];
    this.log = opts.logger ?? skeletonLogger;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private pagesOf(kind: ConfigKind): ConfigPage[] {
    return this.kinds[kind].pages;
  }

  private fieldsOf(kind: ConfigKind): Map<string, ConfigField> {
    return this.kinds[kind].fields;
  }

  /** Kinds this adapter declared pages for. */
  declaredKinds(): ConfigKind[] {
    return CONFIG_KINDS.filter((k) => this.pagesOf(k).length > 0);
  }

  /** Normalises and checks `(kind, id)` of a request. Throws ConfigRequestError(400). */
  static refOf(kind: unknown, id: unknown): ConfigRef {
    const k = kind ?? DEFAULT_KIND;
    if (!isConfigKind(k)) {
      throw new ConfigRequestError(400, ERROR_CODES.badId, `kind must be one of ${CONFIG_KINDS.join(', ')}`, 'kind');
    }
    if (!isConfigId(k, id)) {
      throw new ConfigRequestError(400, ERROR_CODES.badId, ID_RULES[k], 'id');
    }
    return { kind: k, id };
  }

  /** Refuses a kind this adapter declared no pages for: its handler would take the config for another kind. */
  private assertDeclared(kind: ConfigKind): void {
    if (this.pagesOf(kind).length === 0) {
      throw new ConfigRequestError(400, ERROR_CODES.badId, `this adapter has no ${kind} config`, 'kind');
    }
  }

  // ---- merge (value semantics of the contract) ----

  /**
   * Request values on top of `base`. Omitted keeps, "" / null clears, scalars
   * are stringified. Secrets arrive in plaintext and are sealed now for the
   * store (at rest). Problems are collected in `errors`.
   */
  async merge(kind: ConfigKind, request: RequestValues, base?: StoredConfig): Promise<MergeResult> {
    const fields = this.fieldsOf(kind);
    const known = base ? this.pruneUnknown(base) : undefined;
    const values: ConfigValues = { ...(known?.values ?? {}) };
    const secrets: SealedValues = { ...(known?.secrets ?? {}) };
    const cleared: string[] = [];
    const plainSecrets: Record<string, string> = {};
    const errors: ConfigError[] = [];
    const { sealer } = this.opts;

    let kid: string | undefined;
    let publicKey: string | undefined;
    const sealNow = async (plain: string): Promise<SealedValue> => {
      if (!sealer) return plainEnvelope(plain);
      kid = kid ?? await sealer.kid();
      publicKey = publicKey ?? await sealer.publicKey();
      return sealWithPublicKey(publicKey, kid, plain);
    };

    for (const [name, raw] of Object.entries(request)) {
      // clearing works for any key, so a value left behind by a removed field can always be dropped
      if (raw === null || raw === '') {
        delete values[name];
        delete secrets[name];
        delete plainSecrets[name];
        cleared.push(name);
        continue;
      }
      const field = fields.get(name);
      if (!field) {
        errors.push({ path: name, code: ERROR_CODES.unknownField, message: `${name} is not a known field` });
        continue;
      }
      if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
        errors.push({ path: name, code: ERROR_CODES.type, message: `${name} must be a string, number or boolean` });
        continue;
      }
      const str = String(raw);
      if (field.secret) {
        secrets[name] = await sealNow(str);
        plainSecrets[name] = str;
      } else {
        values[name] = str;
      }
    }
    return { values, secrets, cleared, plainSecrets, errors };
  }

  /**
   * Stored keys that are no longer schema fields (field removed or renamed in
   * an adapter upgrade) are dropped with a warning instead of failing
   * validation forever. The row itself is rewritten on the next apply.
   */
  private pruneUnknown(stored: StoredConfig): StoredConfig {
    const fields = this.fieldsOf(stored.kind);
    const values: ConfigValues = {};
    const secrets: SealedValues = {};
    const dropped: string[] = [];
    for (const [name, v] of Object.entries(stored.values)) {
      if (fields.has(name)) values[name] = v;
      else dropped.push(name);
    }
    for (const [name, v] of Object.entries(stored.secrets)) {
      if (fields.has(name)) secrets[name] = v;
      else dropped.push(name);
    }
    if (dropped.length > 0) {
      this.log.warn('config: ignoring stored keys that are not schema fields', { kind: stored.kind, id: stored.id, keys: dropped });
    }
    return { ...stored, values, secrets };
  }

  // ---- secrets ----

  private async openOne(name: string, sealed: SealedValue): Promise<string> {
    if (sealed.kid === PLAIN_KID) {
      // dev-only pseudo envelope: once a real sealer exists, never fall back to it
      if (this.opts.sealer) throw new Error(`${name} was stored without a sealer, re-apply it`);
      if (sealed.enc !== SEAL_ALG) throw new Error('unsupported envelope');
      return Buffer.from(sealed.ciphertext, 'base64').toString('utf8');
    }
    if (!this.opts.sealer) throw new Error(`${name} is sealed but this adapter has no sealer`);
    return openSealed(this.opts.sealer, sealed);
  }

  /** Plaintext of every sealed secret. Throws ConfigRequestError(422, seal-open-failed) with the field path. */
  async open(secrets: SealedValues): Promise<ConfigValues> {
    const out: ConfigValues = {};
    for (const [name, sealed] of Object.entries(secrets)) {
      try {
        out[name] = await this.openOne(name, sealed);
      } catch (e) {
        // the message carries only the field name, never the value
        throw new ConfigRequestError(422, ERROR_CODES.sealOpenFailed, `${name}: cannot open sealed value (${errMsg(e)})`, name);
      }
    }
    return out;
  }

  private async openMerged(m: MergeResult): Promise<ConfigValues> {
    const toOpen: SealedValues = {};
    for (const [name, sealed] of Object.entries(m.secrets)) {
      if (m.plainSecrets[name] === undefined) toOpen[name] = sealed;
    }
    return { ...(await this.open(toOpen)), ...m.plainSecrets };
  }

  // ---- validation ----

  private async baseOf(ref: ConfigRef | undefined): Promise<StoredConfig | undefined> {
    if (!ref) return undefined;
    const entry = this.entries.get(refKey(ref));
    if (entry) return entry.stored;
    return this.opts.store?.get(ref);
  }

  /** Split a values+secrets map with defaults applied into the two ActiveConfig maps (visible fields only). */
  private effective(kind: ConfigKind, values: ConfigValues, opened: ConfigValues): { values: ConfigValues; secrets: ConfigValues } {
    const pages = this.pagesOf(kind);
    const all = withDefaults(pages, { ...values, ...opened });
    const out = { values: {} as ConfigValues, secrets: {} as ConfigValues };
    for (const f of visibleFields(pages, all)) {
      const v = all[f.name];
      if (v === undefined || v === '') continue;
      (f.secret ? out.secrets : out.values)[f.name] = v;
    }
    return out;
  }

  private sanitize(msg: string, secrets: ConfigValues): string {
    return sanitizeMessage(msg, Object.values(secrets));
  }

  /** Static validation, then the handler's live checks. */
  private async runValidation(ref: ConfigRef, values: ConfigValues, opened: ConfigValues): Promise<ValidationResult> {
    const errors = staticValidate(this.pagesOf(ref.kind), { ...values, ...opened });
    if (errors.length > 0) return { ok: false, errors, checks: [] };
    const { check } = this.opts.handler;
    if (!check) return { ok: true, errors: [], checks: [] };
    const eff = this.effective(ref.kind, values, opened);
    let checks: ConfigCheck[];
    try {
      const ms = this.opts.checkTimeoutMs ?? CHECK_TIMEOUT_MS;
      checks = await withTimeout(check.call(this.opts.handler, ref, eff.values, eff.secrets), ms, 'checks');
    } catch (e) {
      checks = [{ id: 'checks', label: 'Live checks', ok: false, message: errMsg(e) }];
    }
    checks = checks.map((c) => (c.message ? { ...c, message: this.sanitize(c.message, opened) } : c));
    return { ok: checks.every((c) => c.ok), errors: [], checks };
  }

  private static asResult(e: unknown): ValidationResult | undefined {
    if (!(e instanceof ConfigRequestError)) return undefined;
    return { ok: false, errors: [{ path: e.path, code: e.code, message: e.message }], checks: [] };
  }

  /**
   * Dry run: merge on top of the stored config (when `id` is given) and
   * validate. Nothing is stored or activated. With no id the ref handed to
   * the handler's check has an empty id.
   */
  async validate(req: ValidateRequest): Promise<ValidationResult> {
    const kind = req.kind ?? DEFAULT_KIND;
    if (!isConfigKind(kind)) {
      throw new ConfigRequestError(400, ERROR_CODES.badId, `kind must be one of ${CONFIG_KINDS.join(', ')}`, 'kind');
    }
    this.assertDeclared(kind);
    const ref: ConfigRef = req.id !== undefined ? ConfigRuntime.refOf(kind, req.id) : { kind, id: '' };
    const base = await this.baseOf(ref.id ? ref : undefined);
    const m = await this.merge(ref.kind, req.values, base);
    if (m.errors.length > 0) return { ok: false, errors: m.errors, checks: [] };
    try {
      const opened = await this.openMerged(m);
      return await this.runValidation(ref, m.values, opened);
    } catch (e) {
      const r = ConfigRuntime.asResult(e);
      if (r) return r;
      throw e;
    }
  }

  // ---- apply ----

  /** State of a config as this process sees it; 'unconfigured' for an unknown ref. */
  stateOf(ref: ConfigRef): ConfigState {
    return this.entries.get(refKey(ref))?.state ?? 'unconfigured';
  }

  /** Whether some config of `kind` already holds the default flag. Asks the store, not this process' memory. */
  private async hasDefault(kind: ConfigKind): Promise<boolean> {
    if (this.opts.store) return (await this.opts.store.list()).some((c) => c.kind === kind && c.isDefault);
    return [...this.entries.values()].some((e) => e.stored.kind === kind && e.stored.isDefault);
  }

  apply(req: ApplyRequest, actor?: string): Promise<ApplyResult> {
    return this.enqueue(async () => {
      const ref = ConfigRuntime.refOf(req.kind, req.id);
      const { kind, id } = ref;
      this.assertDeclared(kind);
      const key = refKey(ref);
      const base = await this.baseOf(ref);
      const name = req.name ?? base?.name ?? id;
      // The first config of a kind becomes its default. Not an account: one investor
      // wallet must not serve the calls that name no address.
      const isDefault = req.default ?? base?.isDefault ?? (kind !== 'account' && !(await this.hasDefault(kind)));

      const m = await this.merge(kind, req.values, base);
      if (m.errors.length > 0) {
        return { ok: false, errors: m.errors, checks: [], kind, id, state: this.stateOf(ref) };
      }
      let opened: ConfigValues;
      let validation: ValidationResult;
      try {
        opened = await this.openMerged(m);
        validation = await this.runValidation(ref, m.values, opened);
      } catch (e) {
        const r = ConfigRuntime.asResult(e);
        if (r) return { ...r, kind, id, state: this.stateOf(ref) };
        throw e;
      }
      if (!validation.ok) return { ...validation, kind, id, state: this.stateOf(ref) };

      // persist first: a failed activation is retried on restart
      const input = { kind, id, name, isDefault, values: m.values, secrets: m.secrets, actor };
      let version: number;
      if (this.opts.store) {
        version = await this.opts.store.save(input);
      } else {
        version = (base?.version ?? 0) + 1;
      }
      const stored: StoredConfig = { ...input, version, updatedAt: new Date() };
      if (isDefault) {
        for (const [otherKey, other] of this.entries) {
          if (otherKey === key || other.stored.kind !== kind) continue;
          other.stored.isDefault = false;
          if (other.active) other.active.isDefault = false;
        }
      }
      const entry: ConfigEntry = { ...(this.entries.get(key) ?? { state: 'unconfigured' }), stored };
      this.entries.set(key, entry);
      this.log.info('config apply', { kind, id, version, actor });

      await this.activate(entry, opened);
      if (entry.state === 'configured') {
        return { ok: true, errors: [], checks: validation.checks, kind, id, version, state: entry.state };
      }
      return {
        ok: false,
        errors: [{ path: '', code: ERROR_CODES.buildFailed, message: entry.lastError ?? 'activation failed' }],
        checks: validation.checks,
        kind,
        id,
        version,
        state: entry.state,
      };
    });
  }

  /** Tear down the handler side of `ref`. Never throws; deactivate must tolerate refs it does not know. */
  private async deactivate(ref: ConfigRef, secrets: ConfigValues = {}): Promise<void> {
    const { handler } = this.opts;
    if (!handler.deactivate) return;
    try {
      await handler.deactivate({ kind: ref.kind, id: ref.id });
    } catch (e) {
      this.log.warn('config deactivate failed', { kind: ref.kind, id: ref.id, error: this.sanitize(errMsg(e), secrets) });
    }
  }

  /**
   * Build the slot for `entry` through the handler. Sets state / lastError. Never throws.
   * The previous ActiveConfig stays readable (get/resolve) until the new one is up, so a
   * re-apply does not turn into a window of failed operations on that ledger.
   */
  private async activate(entry: ConfigEntry, opened: ConfigValues): Promise<void> {
    const { stored } = entry;
    const { handler } = this.opts;
    entry.state = 'applying';
    entry.lastError = undefined;
    try {
      if (entry.active) await this.deactivate(stored, entry.active.secrets);
      const eff = this.effective(stored.kind, stored.values, opened);
      const cfg: ActiveConfig = {
        kind: stored.kind,
        id: stored.id,
        name: stored.name,
        version: stored.version,
        isDefault: stored.isDefault,
        values: eff.values,
        secrets: eff.secrets,
      };
      const ms = this.opts.activateTimeoutMs ?? ACTIVATE_TIMEOUT_MS;
      // a handler that outruns the timeout may still finish and hold resources: drop them then
      const onLate = () => { this.deactivate(stored, eff.secrets).catch(() => undefined); };
      await withTimeout(handler.activate(cfg), ms, 'activate', onLate);
      entry.active = cfg;
      entry.state = 'configured';
      this.log.info('config activated', { kind: stored.kind, id: stored.id, version: stored.version });
    } catch (e) {
      entry.active = undefined;
      entry.state = 'error';
      entry.lastError = this.sanitize(errMsg(e), opened);
      this.log.error('config activation failed', { kind: stored.kind, id: stored.id, version: stored.version, error: entry.lastError });
      // whatever the handler registered before failing must not stay live
      await this.deactivate(stored, opened);
    }
  }

  // ---- remove / restore ----

  remove(ref: ConfigRef): Promise<void> {
    return this.enqueue(async () => {
      const key = refKey(ref);
      const entry = this.entries.get(key);
      if (!entry) throw new ConfigRequestError(404, ERROR_CODES.notFound, `config ${key} not found`);
      const inUse = await this.opts.handler.inUse?.(ref);
      if (inUse) throw new ConfigRequestError(409, ERROR_CODES.inUse, `config ${key} is in use: ${inUse}`);
      if (this.opts.store) {
        try {
          await this.opts.store.remove(ref);
        } catch (e) {
          // row already gone (another instance or a DBA): still drop it here
          if (!isNotFound(e)) throw e;
          this.log.warn('config remove: row was already deleted', { kind: ref.kind, id: ref.id });
        }
      }
      // unconditionally: a config in error may still hold handler resources
      await this.deactivate(ref, entry.active?.secrets);
      this.entries.delete(key);
      this.log.info('config removed', { kind: ref.kind, id: ref.id });
    });
  }

  /**
   * Boot: activate every stored config in RESTORE_ORDER (custody, network,
   * account). No live checks. Never throws; one failing config does
   * not stop the others.
   */
  restore(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.opts.store) return;
      let list: StoredConfig[];
      try {
        list = await this.opts.store.list();
      } catch (e) {
        this.log.error('config restore: cannot list stored configs', { error: errMsg(e) });
        return;
      }
      const order = (k: string) => RESTORE_ORDER[k as ConfigKind] ?? RESTORE_ORDER.network;
      list = [...list].sort((a, b) => order(a.kind) - order(b.kind));
      for (const row of list) {
        if (!isConfigKind(row.kind) || !isConfigId(row.kind, row.id)) {
          this.log.error('config restore: skipping row with an unknown kind or bad id', { kind: row.kind, id: row.id });
          continue;
        }
        if (this.pagesOf(row.kind).length === 0) {
          this.log.error('config restore: skipping row of a kind this adapter has no pages for', { kind: row.kind, id: row.id });
          continue;
        }
        const stored = this.pruneUnknown(row);
        const key = refKey(stored);
        const entry: ConfigEntry = { ...(this.entries.get(key) ?? { state: 'unconfigured' }), stored };
        this.entries.set(key, entry);
        let opened: ConfigValues;
        try {
          opened = await this.open(stored.secrets);
        } catch (e) {
          entry.state = 'error';
          entry.lastError = errMsg(e);
          this.log.error('config restore: cannot open secrets', { kind: stored.kind, id: stored.id, error: entry.lastError });
          continue;
        }
        const errors = staticValidate(this.pagesOf(stored.kind), { ...stored.values, ...opened });
        if (errors.length > 0) {
          // keep the values so describe() shows them; the operator fixes them via apply
          entry.state = 'error';
          entry.lastError = errors.map((e) => e.message).join('; ');
          this.log.error('config restore: stored config is not valid', { kind: stored.kind, id: stored.id, error: entry.lastError });
          continue;
        }
        await this.activate(entry, opened);
      }
    });
  }

  // ---- read side ----

  /** The usable ActiveConfig of `ref`: configured, or the previous version while a re-apply is in flight. */
  get(ref: ConfigRef): ActiveConfig | undefined {
    const entry = this.entries.get(refKey(ref));
    if (!entry) return undefined;
    return entry.state === 'configured' || entry.state === 'applying' ? entry.active : undefined;
  }

  /** The network config of a ledger. Undefined when none is configured (down, applying from scratch, or unknown). */
  resolve(network: string): ActiveConfig | undefined {
    return this.get({ kind: 'network', id: network });
  }

  /** The account config of `address` on `ledger` (CAIP-2). Undefined when none is usable: the caller uses the network connection. */
  account(ledger: string, address: string): ActiveConfig | undefined {
    return this.get({ kind: 'account', id: accountConfigId(ledger, address) });
  }

  /** The default config of `kind` when it is usable. */
  defaultOf(kind: ConfigKind): ActiveConfig | undefined {
    for (const entry of this.entries.values()) {
      if (entry.stored.kind === kind && entry.stored.isDefault) return this.get(entry.stored);
    }
    return undefined;
  }

  /** Ledgers with a usable network config. */
  networks(): string[] {
    return [...this.entries.values()]
      .filter((e) => e.stored.kind === 'network' && this.get(e.stored))
      .map((e) => e.stored.id);
  }

  private summaryOf(entry: ConfigEntry): ConfigSummary {
    const { stored } = entry;
    const values: Record<string, DescriptorValue> = {};
    for (const f of this.fieldsOf(stored.kind).values()) {
      if (f.secret) values[f.name] = { set: stored.secrets[f.name] !== undefined };
      else if (stored.values[f.name] !== undefined) values[f.name] = stored.values[f.name];
    }
    return {
      kind: stored.kind,
      id: stored.id,
      name: stored.name,
      state: entry.state,
      version: stored.version,
      lastError: entry.lastError,
      isDefault: stored.isDefault,
      values,
    };
  }

  list(): ConfigSummary[] {
    return [...this.entries.values()].map((e) => this.summaryOf(e));
  }

  /** Ready when at least one network is configured; every applying/errored config is listed as blocking. */
  readiness(): { ready: boolean; blocking: string[] } {
    const blocking: string[] = [];
    let ready = false;
    let networks = 0;
    for (const entry of this.entries.values()) {
      const label = refKey(entry.stored);
      if (entry.stored.kind === 'network') networks += 1;
      if (entry.state === 'configured' && entry.stored.kind === 'network') ready = true;
      if (entry.state === 'applying') blocking.push(`${label}: config is being applied`);
      if (entry.state === 'error') blocking.push(`${label}: ${entry.lastError ?? 'activation failed'}`);
    }
    if (networks === 0) blocking.push('no network configured yet');
    return { ready, blocking };
  }

  describe(): Promise<ConfigDescriptor> {
    return Promise.resolve({
      protocol: PROTOCOL,
      adapter: this.opts.adapter,
      pages: this.opts.pages,
      configs: this.list(),
      readiness: this.readiness(),
    });
  }
}

// Generic, ledger-agnostic helpers over the page/field schema: defaults,
// visibility, static validation and secret redaction. Pure functions.
import {
  ConfigError, ConfigField, ConfigKind, ConfigPage, ConfigValues, DEFAULT_KIND, ERROR_CODES, FieldCondition, ScalarValue,
} from './types';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]+$/;
export const REDACTED = '[redacted]';

/** name -> field, across all pages. */
export function fieldIndex(pages: ConfigPage[]): Map<string, ConfigField> {
  const idx = new Map<string, ConfigField>();
  for (const page of pages) {
    for (const f of page.fields) idx.set(f.name, f);
  }
  return idx;
}

/** Values with field defaults filled in. Used for visibility and validation. */
export function withDefaults(pages: ConfigPage[], values: ConfigValues): ConfigValues {
  const out: ConfigValues = { ...values };
  for (const page of pages) {
    for (const f of page.fields) {
      if ((out[f.name] === undefined || out[f.name] === '') && f.default !== undefined) {
        out[f.name] = String(f.default);
      }
    }
  }
  return out;
}

export function conditionHolds(cond: FieldCondition | undefined, values: ConfigValues): boolean {
  if (!cond) return true;
  const actual = values[cond.field];
  const same = (expected: ScalarValue) => String(expected) === actual;
  if (cond.equals !== undefined) return same(cond.equals);
  if (cond.in) return cond.in.some(same);
  return true;
}

/** Fields the user can see right now. `values` should already have defaults. */
export function visibleFields(pages: ConfigPage[], values: ConfigValues): ConfigField[] {
  const out: ConfigField[] = [];
  for (const page of pages) {
    if (!conditionHolds(page.visibleWhen, values)) continue;
    for (const f of page.fields) {
      if (conditionHolds(f.visibleWhen, values)) out.push(f);
    }
  }
  return out;
}

// ---- secrets in messages ----

/** Values of secret fields present in a values map. */
export function secretValuesOf(pages: ConfigPage[], values: ConfigValues): string[] {
  const idx = fieldIndex(pages);
  return Object.entries(values)
    .filter(([name, v]) => v && idx.get(name)?.secret)
    .map(([, v]) => v);
}

/** Strip `user:pass@` from URLs and replace any known secret value with [redacted]. */
export function sanitizeMessage(msg: string, secrets: Iterable<string>): string {
  let out = msg.replace(/\/\/[^/@\s]*@/g, '//');
  // longest first so a short secret inside a longer one does not mask it
  const list = [...new Set([...secrets])].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  for (const s of list) out = out.split(s).join(REDACTED);
  return out;
}

/** Short message of an unknown error. Prefers `shortMessage` (ethers style) over the full dump. */
export const errMsg = (e: unknown): string => {
  const short = (e as { shortMessage?: unknown })?.shortMessage;
  if (typeof short === 'string' && short) return short;
  return e instanceof Error ? e.message : String(e);
};

// ---- static validation ----

const err = (path: string, code: string, message: string): ConfigError => ({ path, code, message });

function checkType(f: ConfigField, v: string): ConfigError | undefined {
  // messages never include `v`: the field may be a secret
  switch (f.type) {
    case 'url': {
      let u: URL;
      try { u = new URL(v); } catch { return err(f.name, ERROR_CODES.type, `${f.name} must be a valid URL`); }
      // a non-secret value is stored in plaintext and echoed by GET /config: never let creds ride in it
      if (u.username || u.password) return err(f.name, ERROR_CODES.type, `${f.name} must not embed credentials, use the secret auth field`);
      return undefined;
    }
    case 'address':
      return ADDRESS_RE.test(v) ? undefined : err(f.name, ERROR_CODES.type, `${f.name} must be an address (0x + 40 hex chars)`);
    case 'hex':
      return HEX_RE.test(v) ? undefined : err(f.name, ERROR_CODES.type, `${f.name} must be 0x-prefixed hex`);
    case 'number': {
      const n = Number(v);
      if (v.trim() === '' || !Number.isFinite(n)) return err(f.name, ERROR_CODES.type, `${f.name} must be a number`);
      if (f.min !== undefined && n < f.min) return err(f.name, ERROR_CODES.min, `${f.name} must be >= ${f.min}`);
      if (f.max !== undefined && n > f.max) return err(f.name, ERROR_CODES.max, `${f.name} must be <= ${f.max}`);
      return undefined;
    }
    case 'boolean':
      return v === 'true' || v === 'false' ? undefined : err(f.name, ERROR_CODES.type, `${f.name} must be true or false`);
    case 'enum': {
      const allowed = (f.options ?? []).map((o) => o.value);
      return allowed.includes(v) ? undefined : err(f.name, ERROR_CODES.enum, `${f.name} must be one of: ${allowed.join(', ')}`);
    }
    default:
      return undefined;
  }
}

/**
 * Static checks only: required (visible fields only), type, pattern, min/max,
 * and keys that are not in the schema. `values` = merged values incl. opened
 * secrets; defaults are applied here.
 */
export function staticValidate(pages: ConfigPage[], values: ConfigValues): ConfigError[] {
  const idx = fieldIndex(pages);
  const eff = withDefaults(pages, values);
  const errors: ConfigError[] = [];
  for (const name of Object.keys(values)) {
    if (!idx.has(name)) errors.push(err(name, ERROR_CODES.unknownField, `${name} is not a known field`));
  }
  for (const f of visibleFields(pages, eff)) {
    const v = eff[f.name];
    if (v === undefined || v === '') {
      if (f.required) errors.push(err(f.name, ERROR_CODES.required, `${f.name} is required`));
      continue;
    }
    const typeErr = checkType(f, v);
    if (typeErr) { errors.push(typeErr); continue; }
    if (f.pattern && !new RegExp(f.pattern).test(v)) {
      errors.push(err(f.name, ERROR_CODES.pattern, `${f.name} does not match the expected pattern`));
    }
  }
  const secrets = secretValuesOf(pages, eff);
  return errors.map((e) => ({ ...e, message: sanitizeMessage(e.message, secrets) }));
}

/** Pages of one kind (`page.kind`, 'network' when omitted). */
export function pagesOfKind(pages: ConfigPage[], kind: ConfigKind): ConfigPage[] {
  return pages.filter((p) => (p.kind ?? DEFAULT_KIND) === kind);
}

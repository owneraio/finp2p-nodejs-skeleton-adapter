import { Log, Meta, fromSink } from './log';

export const REDACTED = '[redacted]';

export interface RedactOptions {
  /** Literal secret values to erase wherever they appear (see `secretsFromEnv`). */
  readonly secrets?: readonly string[];
  /** Extra meta/text key names whose values are erased. Compared after lowercasing and dropping `_`/`-`. */
  readonly keys?: readonly string[];
  /** Extra text patterns; every match is replaced with `[redacted]`. Must be global (`/g`). */
  readonly patterns?: readonly RegExp[];
}

// Key names that hold secrets. Bare `token` is NOT here: FinP2P uses tokenId/tokenAddress everywhere.
const SECRET_KEYS = new Set([
  'password', 'passwd', 'pwd', 'secret', 'apikey', 'apisecret', 'privatekey', 'privatekeybase64',
  'mnemonic', 'seedphrase', 'credential', 'credentials', 'authorization', 'cookie', 'setcookie',
  'accesstoken', 'refreshtoken', 'authtoken', 'idtoken', 'bearertoken', 'clientsecret',
  'networkauth', 'connectionstring',
]);
const SECRET_KEY_SUFFIXES = [
  'password', 'passwd', 'secret', 'privatekey', 'privatekeybase64', 'apikey', 'authtoken',
  'accesstoken', 'refreshtoken', 'connectionstring', 'credentials', 'mnemonic',
];

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');

export function isSecretKey(key: string, extra: readonly string[] = []): boolean {
  const k = normalizeKey(key);
  return SECRET_KEYS.has(k)
    || SECRET_KEY_SUFFIXES.some((s) => k.endsWith(s))
    || extra.some((e) => normalizeKey(e) === k);
}

// Patterns applied to every string (message, meta values).
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const HTTP_AUTH = /\b(bearer|basic)\s+[a-z0-9\-._~+/]+=*/gi;
const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
// `KEY=value`, `key: value`, `"key":"value"`; value erased only when the key is a secret key.
const KEY_VALUE = /\b([a-z0-9_.-]+)["']?(\s*[=:]\s*)(["']?)((?:bearer|basic)\s+)?([^\s"',;&]+)\3/gi;

const escapeForJson = (s: string): string => JSON.stringify(s).slice(1, -1);

// Secret values from env vars whose names look like secrets. Longest first so a short
// secret that is a substring of a longer one cannot mask it. JSON-escaped forms included.
export function secretsFromEnv(env: NodeJS.ProcessEnv = process.env, extraKeys: readonly string[] = []): string[] {
  const values = new Set<string>();
  Object.entries(env).forEach(([key, value]) => {
    if (!value || !isSecretKey(key, extraKeys)) return;
    values.add(value);
    const escaped = escapeForJson(value);
    if (escaped !== value) values.add(escaped);
  });
  return [...values].sort((a, b) => b.length - a.length);
}

export function redactText(text: string, options: RedactOptions = {}): string {
  let out = text;
  (options.secrets ?? []).forEach((s) => {
    if (s) out = out.split(s).join(REDACTED);
  });
  out = out.replace(URL_USERINFO, `$1${REDACTED}@`);
  out = out.replace(HTTP_AUTH, `$1 ${REDACTED}`);
  out = out.replace(PEM_PRIVATE_KEY, REDACTED);
  out = out.replace(KEY_VALUE, (m, key: string, sep: string, q: string, scheme: string | undefined) => (
    isSecretKey(key, options.keys) ? `${key}${q}${sep}${q}${scheme ?? ''}${REDACTED}${q}` : m
  ));
  (options.patterns ?? []).forEach((p) => {
    out = out.replace(p, REDACTED);
  });
  return out;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

function redactValue(value: unknown, options: RedactOptions, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value, options);
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    return value.map((v) => redactValue(v, options, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out: Record<string, unknown> = {};
    Object.entries(value).forEach(([k, v]) => {
      out[k] = isSecretKey(k, options.keys) ? REDACTED : redactValue(v, options, seen);
    });
    return out;
  }
  return value;
}

export function redactMeta(meta: Meta, options: RedactOptions = {}): Meta {
  return redactValue(meta, options, new WeakSet()) as Meta;
}

// Wraps any Log. Message and meta are redacted before they reach `log`.
export function withRedaction(log: Log, options: RedactOptions = {}): Log {
  return fromSink((level, message, meta) => {
    log[level](redactText(message, options), redactMeta(meta, options));
  });
}

import type { Meta } from './log';
import { isPlainObject, mapValues } from './object';

export const REDACTED = '[redacted]';

export interface RedactOptions {
  readonly secrets?: readonly string[];
  readonly keys?: readonly string[];
  readonly patterns?: readonly RegExp[];
}

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

const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const HTTP_AUTH = /\b(bearer|basic)\s+[a-z0-9\-._~+/]+=*/gi;
const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const KEY_VALUE = /\b([a-z0-9_.-]+)["']?(\s*[=:]\s*)(["']?)((?:bearer|basic)\s+)?([^\s"',;&]+)\3/gi;

const escapeForJson = (s: string): string => JSON.stringify(s).slice(1, -1);
const longestFirst = (a: string, b: string): number => b.length - a.length;
const withGlobalFlag = (p: RegExp): RegExp => (p.global ? p : new RegExp(p.source, `${p.flags}g`));

export function secretsFromEnv(env: NodeJS.ProcessEnv = process.env, extraKeys: readonly string[] = []): string[] {
  const values = new Set<string>();
  Object.entries(env).forEach(([key, value]) => {
    if (!value || !isSecretKey(key, extraKeys)) return;
    values.add(value);
    values.add(escapeForJson(value));
  });
  return [...values].sort(longestFirst);
}

export function redactText(text: string, options: RedactOptions = {}): string {
  let out = text;
  (options.secrets ?? []).filter(Boolean).forEach((s) => {
    out = out.replaceAll(s, REDACTED);
  });
  out = out.replace(URL_USERINFO, `$1${REDACTED}@`);
  out = out.replace(HTTP_AUTH, `$1 ${REDACTED}`);
  out = out.replace(PEM_PRIVATE_KEY, REDACTED);
  out = out.replace(KEY_VALUE, (match, key: string, sep: string, quote: string, scheme = '') => (
    isSecretKey(key, options.keys) ? `${key}${quote}${sep}${quote}${scheme}${REDACTED}${quote}` : match
  ));
  (options.patterns ?? []).forEach((p) => {
    out = out.replace(withGlobalFlag(p), REDACTED);
  });
  return out;
}

function redactValue(value: unknown, options: RedactOptions, ancestors: readonly object[] = []): unknown {
  if (typeof value === 'string') return redactText(value, options);
  if (typeof value !== 'object' || value === null) return value;
  if (ancestors.includes(value)) return '[circular]';
  const path = [...ancestors, value];
  const visit = (v: unknown): unknown => redactValue(v, options, path);
  if (Array.isArray(value)) return value.map(visit);
  if (isPlainObject(value)) {
    return mapValues(value, (v, k) => (isSecretKey(k, options.keys) ? REDACTED : visit(v)));
  }
  return value;
}

export const redactMeta = (meta: Meta, options: RedactOptions = {}): Meta => redactValue(meta, options) as Meta;

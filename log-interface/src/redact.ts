import type { Meta } from './log';
import { isPlainObject, mapValues } from './object';

export const REDACTED = '[redacted]';

export interface RedactOptions {
  readonly secrets?: readonly string[];
  readonly keys?: readonly string[];
  readonly patterns?: readonly RegExp[];
}

export interface Redactor {
  readonly text: (text: string) => string;
  readonly meta: (meta: Meta) => Meta;
}

type Rule = (text: string) => string;

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

const escapeForJson = (s: string): string => JSON.stringify(s).slice(1, -1);

export function secretsFromEnv(env: NodeJS.ProcessEnv = process.env, extraKeys: readonly string[] = []): string[] {
  const values = new Set<string>();
  Object.entries(env).forEach(([key, value]) => {
    if (!value || !isSecretKey(key, extraKeys)) return;
    values.add(value);
    values.add(escapeForJson(value));
  });
  return [...values];
}

function positionsOf(secret: string, text: string): number[] {
  const found: number[] = [];
  for (let i = text.indexOf(secret); i !== -1; i = text.indexOf(secret, i + 1)) found.push(i);
  return found;
}

function hiddenChars(text: string, secrets: readonly string[]): boolean[] {
  const hidden = new Array<boolean>(text.length).fill(false);
  secrets.forEach((secret) => positionsOf(secret, text).forEach((i) => hidden.fill(true, i, i + secret.length)));
  return hidden;
}

function collapse(text: string, hidden: readonly boolean[]): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (!hidden[i]) out += text[i];
    else if (!hidden[i - 1]) out += REDACTED;
  }
  return out;
}

function hideSecrets(secrets: readonly string[]): Rule {
  const unique = [...new Set(secrets)].filter(Boolean);
  return (text) => {
    const present = unique.filter((s) => text.includes(s));
    return present.length === 0 ? text : collapse(text, hiddenChars(text, present));
  };
}

const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const HTTP_AUTH = /\b(bearer|basic)\s+[a-z0-9\-._~+/]+=*/gi;
const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const QUOTED_PAIR = /\b([a-z0-9_.-]+)(\\?["']?\s*[=:]\s*(\\?["']))((?:\\.|[^\\])*?)\3/gi;
const BARE_PAIR = /\b([a-z0-9_.-]+)(\\?["']?\s*[=:]\s*(?:(?:bearer|basic)\s+)?)((?!\\["'])[^\s"',;&]+)/gi;

function hidePairs(text: string, keys: readonly string[]): string {
  const hide = (key: string, value: string): string => (isSecretKey(key, keys) ? REDACTED : hidePairs(value, keys));
  return text
    .replace(QUOTED_PAIR, (_, key: string, head: string, quote: string, value: string) => `${key}${head}${hide(key, value)}${quote}`)
    .replace(BARE_PAIR, (_, key: string, head: string, value: string) => `${key}${head}${hide(key, value)}`);
}

const replacing = (pattern: RegExp, replacement: string): Rule => (text) => text.replace(pattern, replacement);

const withGlobalFlag = (p: RegExp): RegExp => (p.global ? p : new RegExp(p.source, `${p.flags}g`));

function textRedactor({ secrets = [], keys = [], patterns = [] }: RedactOptions): Rule {
  const rules: Rule[] = [
    hideSecrets(secrets),
    replacing(URL_USERINFO, `$1${REDACTED}@`),
    replacing(HTTP_AUTH, `$1 ${REDACTED}`),
    replacing(PEM_PRIVATE_KEY, REDACTED),
    (text) => hidePairs(text, keys),
    ...patterns.map((p) => replacing(withGlobalFlag(p), REDACTED)),
  ];
  return (text) => rules.reduce((out, rule) => rule(out), text);
}

function metaRedactor(text: Rule, keys: readonly string[]): (meta: Meta) => Meta {
  const redact = (value: unknown, ancestors: readonly object[]): unknown => {
    if (typeof value === 'string') return text(value);
    if (typeof value !== 'object' || value === null) return value;
    if (ancestors.includes(value)) return '[circular]';
    const path = [...ancestors, value];
    const visit = (v: unknown): unknown => redact(v, path);
    if (Array.isArray(value)) return value.map(visit);
    if (isPlainObject(value)) return mapValues(value, (v, k) => (isSecretKey(k, keys) ? REDACTED : visit(v)));
    return value;
  };
  return (meta) => redact(meta, []) as Meta;
}

export function redactor(options: RedactOptions = {}): Redactor {
  const text = textRedactor(options);
  return { text, meta: metaRedactor(text, options.keys ?? []) };
}

export const redactText = (text: string, options?: RedactOptions): string => redactor(options).text(text);

export const redactMeta = (meta: Meta, options?: RedactOptions): Meta => redactor(options).meta(meta);

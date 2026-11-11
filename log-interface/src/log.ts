import { isPlainObject, mapValues } from './object';
import { RedactOptions, redactMeta, redactText } from './redact';

const LOG = '@owneraio/log-interface';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export const LEVELS: readonly Level[] = ['debug', 'info', 'warn', 'error'];

export type Meta = Readonly<Record<string, unknown>>;

export type LogFn = (message: string, meta?: Meta) => void;

export interface Log {
  readonly [LOG]: true;
  readonly debug: LogFn;
  readonly info: LogFn;
  readonly warn: LogFn;
  readonly error: LogFn;
  child(meta: Meta): Log;
}

export const isLog = (x: unknown): x is Log => (x as Log | undefined)?.[LOG] === true;

export const isLevel = (x: unknown): x is Level => LEVELS.includes(x as Level);

type Visit = (value: unknown) => unknown;

function normalizeError(e: Error, visit: Visit): Record<string, unknown> {
  const own = visit({ ...e }) as Record<string, unknown>;
  const out = { ...own, name: e.name, message: e.message, stack: e.stack };
  return e.cause === undefined ? out : { ...out, cause: visit(e.cause) };
}

function normalize(value: unknown, ancestors: readonly object[] = []): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (ancestors.includes(value)) return '[circular]';
  const path = [...ancestors, value];
  const visit: Visit = (v) => normalize(v, path);
  if (value instanceof Error) return normalizeError(value, visit);
  if (Array.isArray(value)) return value.map(visit);
  if (isPlainObject(value)) return mapValues(value, visit);
  return value;
}

export const normalizeMeta = (meta: Meta): Meta => normalize(meta) as Meta;

export type Sink = (level: Level, message: string, meta: Meta) => void;

export interface LogOptions {
  readonly base?: Meta;
  readonly redact?: RedactOptions;
}

export function fromSink(sink: Sink, { base = {}, redact }: LogOptions = {}): Log {
  const at = (level: Level): LogFn => (message, meta) => {
    const all = normalizeMeta({ ...base, ...meta });
    if (redact) sink(level, redactText(message, redact), redactMeta(all, redact));
    else sink(level, message, all);
  };
  return {
    [LOG]: true,
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (meta) => fromSink(sink, { base: { ...base, ...meta }, redact }),
  };
}

export const withRedaction = (log: Log, redact: RedactOptions = {}): Log => (
  fromSink((level, message, meta) => log[level](message, meta), { redact })
);

export const silentLog = (): Log => fromSink(() => {});

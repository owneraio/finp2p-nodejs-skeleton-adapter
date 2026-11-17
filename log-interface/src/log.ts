import { isPlainObject, mapValues } from './object';
import { RedactOptions, Redactor, redactor } from './redact';

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

export const atLeast = (threshold: Level) => (level: Level): boolean => LEVELS.indexOf(level) >= LEVELS.indexOf(threshold);

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

export interface SinkOptions extends LogOptions {
  readonly enabled?: (level: Level) => boolean;
}

interface Pipeline {
  readonly sink: Sink;
  readonly base: Meta;
  readonly redact: Redactor;
  readonly enabled: (level: Level) => boolean;
}

const noop = (): void => {};

const identity = <T>(x: T): T => x;

const NO_REDACTION: Redactor = { text: identity, meta: identity };

function attempt(run: () => void, recover: (error: unknown) => void = noop): void {
  try {
    run();
  } catch (error) {
    recover(error);
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function write(p: Pipeline, level: Level, message: string, meta: Meta): void {
  const all = normalizeMeta({ ...p.base, ...meta });
  p.sink(level, p.redact.text(message), p.redact.meta(all));
}

function writeFailure(p: Pipeline, level: Level, message: string, error: unknown): void {
  p.sink(level, p.redact.text(message), { logError: p.redact.text(errorText(error)) });
}

function emit(p: Pipeline, level: Level, message: string, meta: Meta = {}): void {
  if (!p.enabled(level)) return;
  attempt(
    () => write(p, level, message, meta),
    (error) => attempt(() => writeFailure(p, level, message, error)),
  );
}

function build(p: Pipeline): Log {
  const at = (level: Level): LogFn => (message, meta) => emit(p, level, message, meta);
  return {
    [LOG]: true,
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (meta) => build({ ...p, base: { ...p.base, ...meta } }),
  };
}

export function fromSink(sink: Sink, { base = {}, redact, enabled = () => true }: SinkOptions = {}): Log {
  return build({
    sink, base, enabled, redact: redact ? redactor(redact) : NO_REDACTION,
  });
}

export const withRedaction = (log: Log, redact: RedactOptions = {}): Log => (
  fromSink((level, message, meta) => log[level](message, meta), { redact })
);

const SILENT: Log = {
  [LOG]: true, debug: noop, info: noop, warn: noop, error: noop, child: () => SILENT,
};

export const silentLog = (): Log => SILENT;

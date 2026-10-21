// Type-only brand. Nothing at runtime, so no object literal or third-party
// logger can satisfy `Log` by accident; only this package's factories can.
declare const LOG: unique symbol;

export type Level = 'debug' | 'info' | 'warn' | 'error';

export const LEVELS: readonly Level[] = ['debug', 'info', 'warn', 'error'];

// Interface-typed values are not assignable here; spread them: `{ ...cfg }`.
export type Meta = Readonly<Record<string, unknown>>;

export type LogFn = (message: string, meta?: Meta) => void;

export interface Log {
  readonly [LOG]: true;
  readonly debug: LogFn;
  readonly info: LogFn;
  readonly warn: LogFn;
  readonly error: LogFn;
  /** Same log, with `meta` attached to every entry. */
  child(meta: Meta): Log;
}

export const isLevel = (x: unknown): x is Level => LEVELS.includes(x as Level);

// Error → { name, message, stack }, so JSON formats keep the stack.
export function normalizeMeta(meta: Meta): Meta {
  let out: Record<string, unknown> | undefined;
  Object.entries(meta).forEach(([k, v]) => {
    if (v instanceof Error) {
      out ??= { ...meta };
      out[k] = { name: v.name, message: v.message, stack: v.stack };
    }
  });
  return out ?? meta;
}

// Receives every entry; filtering and output are the sink's job.
export type Sink = (level: Level, message: string, meta: Meta) => void;

// Build a Log from any sink. Use for backends not shipped here (pino, spies).
export function fromSink(sink: Sink, base: Meta = {}): Log {
  const at = (level: Level): LogFn => (message, meta) => {
    sink(level, message, normalizeMeta(meta ? { ...base, ...meta } : base));
  };
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (meta) => fromSink(sink, { ...base, ...meta }),
  } as Log;
}

export const silentLog = (): Log => fromSink(() => {});

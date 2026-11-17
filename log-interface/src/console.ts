import {
  Level, Log, LogOptions, Meta, Sink, atLeast, fromSink,
} from './log';

type Target = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

export interface ConsoleOptions extends LogOptions {
  readonly level?: Level;
  readonly target?: Target;
  readonly format?: 'pretty' | 'json';
}

function jsonReplacer() {
  const path: object[] = [];
  return function replace(this: object, _: string, value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value !== 'object' || value === null) return value;
    while (path.length > 0 && path.at(-1) !== this) path.pop();
    if (path.includes(value)) return '[circular]';
    path.push(value);
    return value;
  };
}

const toJson = (level: Level, message: string, meta: Meta): string => (
  JSON.stringify({ ...meta, level, time: new Date().toISOString(), msg: message }, jsonReplacer())
);

const jsonSink = (target: Target): Sink => (level, message, meta) => target[level](toJson(level, message, meta));

const prettySink = (target: Target): Sink => (level, message, meta) => {
  const tag = `[${level.toUpperCase()}]`;
  if (Object.keys(meta).length > 0) target[level](tag, message, meta);
  else target[level](tag, message);
};

export function fromConsole(options: ConsoleOptions = {}): Log {
  const {
    level = 'info', target = console, format = 'pretty', ...rest
  } = options;
  const sink = format === 'json' ? jsonSink(target) : prettySink(target);
  return fromSink(sink, { ...rest, isLevelEnabled: atLeast(level) });
}

import {
  Level, LEVELS, Log, LogOptions, fromSink,
} from './log';

export interface ConsoleOptions extends LogOptions {
  readonly level?: Level;
  readonly target?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  readonly format?: 'pretty' | 'json';
}

const rank = (level: Level): number => LEVELS.indexOf(level);

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

export function fromConsole(options: ConsoleOptions = {}): Log {
  const {
    level = 'info', target = console, format = 'pretty', ...rest
  } = options;
  const threshold = rank(level);

  return fromSink((lvl, message, meta) => {
    if (rank(lvl) < threshold) return;
    if (format === 'json') {
      const entry = { ...meta, level: lvl, time: new Date().toISOString(), msg: message };
      target[lvl](JSON.stringify(entry, jsonReplacer()));
      return;
    }
    const tag = `[${lvl.toUpperCase()}]`;
    if (Object.keys(meta).length > 0) target[lvl](tag, message, meta);
    else target[lvl](tag, message);
  }, rest);
}

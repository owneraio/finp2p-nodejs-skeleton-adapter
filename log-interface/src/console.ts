import {
  Level, LEVELS, Log, fromSink,
} from './log';

export interface ConsoleOptions {
  /** Minimum level. Default `info`. */
  readonly level?: Level;
  /** Default: global `console`. */
  readonly target?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  /** `pretty`: `[LEVEL] message {meta}`. `json`: one object per line. Default `pretty`. */
  readonly format?: 'pretty' | 'json';
}

const rank = (level: Level): number => LEVELS.indexOf(level);

export function fromConsole(options: ConsoleOptions = {}): Log {
  const {
    level = 'info',
    target = console,
    format = 'pretty',
  } = options;
  const threshold = rank(level);

  return fromSink((lvl, message, meta) => {
    if (rank(lvl) < threshold) return;
    if (format === 'json') {
      target[lvl](JSON.stringify({
        ...meta, level: lvl, time: new Date().toISOString(), msg: message,
      }));
      return;
    }
    const tag = `[${lvl.toUpperCase()}]`;
    if (Object.keys(meta).length > 0) target[lvl](tag, message, meta);
    else target[lvl](tag, message);
  });
}

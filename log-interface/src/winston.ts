import type * as winston from 'winston';
import {
  Level, LEVELS, Log, LogOptions, fromSink,
} from './log';

const WINSTON_NAMES: Readonly<Record<Level, readonly string[]>> = {
  debug: ['debug'],
  info: ['info'],
  warn: ['warn', 'warning'],
  error: ['error'],
};

export class UnsupportedWinstonLevelsError extends Error {
  constructor(public readonly level: Level, public readonly available: readonly string[]) {
    super(`winston logger has no level for "${level}" (tried ${WINSTON_NAMES[level].join(', ')}); available: ${available.join(', ')}`);
    this.name = 'UnsupportedWinstonLevelsError';
  }
}

function resolveLevels(w: winston.Logger): Record<Level, string> {
  const table = w.levels ?? {};
  const out = {} as Record<Level, string>;
  LEVELS.forEach((level) => {
    const found = WINSTON_NAMES[level].find((name) => name in table);
    if (found === undefined) throw new UnsupportedWinstonLevelsError(level, Object.keys(table));
    out[level] = found;
  });
  return out;
}

export function fromWinston(w: winston.Logger, options?: LogOptions): Log {
  const names = resolveLevels(w);
  return fromSink((level, message, meta) => {
    w.log({ ...meta, level: names[level], message });
  }, options);
}

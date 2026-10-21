import type * as winston from 'winston';
import {
  Level, LEVELS, Log, fromSink,
} from './log';

// winston names the warn level `warn` (npm table) or `warning` (syslog table).
// Its Logger type declares both methods; only one exists at runtime.
// We pick the right name once, here, from `w.levels`.
const ALIASES: Readonly<Record<Level, readonly string[]>> = {
  debug: ['debug'],
  info: ['info'],
  warn: ['warn', 'warning'],
  error: ['error'],
};

export class UnsupportedWinstonLevelsError extends Error {
  constructor(public readonly level: Level, public readonly available: readonly string[]) {
    super(`winston logger has no level for "${level}" (tried ${ALIASES[level].join(', ')}); available: ${available.join(', ')}`);
    this.name = 'UnsupportedWinstonLevelsError';
  }
}

function resolveLevels(w: winston.Logger): Record<Level, string> {
  const table = w.levels ?? {};
  const out = {} as Record<Level, string>;
  LEVELS.forEach((level) => {
    const found = ALIASES[level].find((name) => name in table);
    if (found === undefined) throw new UnsupportedWinstonLevelsError(level, Object.keys(table));
    out[level] = found;
  });
  return out;
}

// Works with any levels table that has debug/info/error and warn or warning.
// Always calls `w.log(info)`, never `w[level]()`.
export function fromWinston(w: winston.Logger): Log {
  const names = resolveLevels(w);
  return fromSink((level, message, meta) => {
    w.log({ ...meta, level: names[level], message });
  });
}

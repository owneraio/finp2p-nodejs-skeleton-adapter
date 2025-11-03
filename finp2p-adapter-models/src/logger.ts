export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warning(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const LEVEL_ORDER = ['debug', 'info', 'warn', 'error'] as const;

export class ConsoleLogger implements Logger {
  private currentLevelIndex: number;

  constructor(level: typeof LEVEL_ORDER[number] = 'info') {
    this.currentLevelIndex = LEVEL_ORDER.indexOf(level);
  }

  private shouldLog(level: typeof LEVEL_ORDER[number]) {
    return LEVEL_ORDER.indexOf(level) >= this.currentLevelIndex;
  }

  debug(...args: unknown[]) {
    if (this.shouldLog('debug')) console.debug('[DEBUG]', ...args);
  }

  info(...args: unknown[]) {
    if (this.shouldLog('info')) console.info('[INFO]', ...args);
  }

  warning(...args: unknown[]) {
    if (this.shouldLog('warn')) console.warn('[WARN]', ...args);
  }

  error(...args: unknown[]) {
    if (this.shouldLog('error')) console.error('[ERROR]', ...args);
  }
}

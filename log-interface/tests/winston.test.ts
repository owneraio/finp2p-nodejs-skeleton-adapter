import * as winston from 'winston';
import Transport from 'winston-transport';
import { fromWinston, UnsupportedWinstonLevelsError } from '../src/winston';

type Entry = Record<string, unknown>;

class Capture extends Transport {
  entries: Entry[] = [];

  log(info: Entry, next: () => void) {
    // drop winston's Symbol(level)/Symbol(message) keys; keep enumerable string keys only
    this.entries.push(Object.fromEntries(Object.entries(info)));
    next();
  }
}

const withLevels = (levels: winston.config.AbstractConfigSetLevels, level: string) => {
  const capture = new Capture();
  const w = winston.createLogger({
    levels, level, transports: [capture], format: winston.format.simple(),
  });
  return { w, capture };
};

describe('fromWinston', () => {
  it('maps warn -> warning on a syslog-levels logger', () => {
    const { w, capture } = withLevels(winston.config.syslog.levels, 'debug');
    const log = fromWinston(w);
    log.warn('careful', { planId: 'p1' });
    expect(capture.entries).toEqual([{ level: 'warning', message: 'careful', planId: 'p1' }]);
  });

  it('maps warn -> warn on an npm-levels logger', () => {
    const { w, capture } = withLevels(winston.config.npm.levels, 'debug');
    const log = fromWinston(w);
    log.warn('careful');
    expect(capture.entries).toEqual([{ level: 'warn', message: 'careful' }]);
  });

  it('emits every level with the resolved name', () => {
    const { w, capture } = withLevels(winston.config.syslog.levels, 'debug');
    const log = fromWinston(w);
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(capture.entries.map((e) => e.level)).toEqual(['debug', 'info', 'warning', 'error']);
  });

  it('respects the winston level threshold', () => {
    const { w, capture } = withLevels(winston.config.npm.levels, 'warn');
    const log = fromWinston(w);
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(capture.entries.map((e) => e.level)).toEqual(['warn', 'error']);
  });

  it('child() attaches meta to every entry and composes', () => {
    const { w, capture } = withLevels(winston.config.npm.levels, 'debug');
    const log = fromWinston(w).child({ planId: 'p1' }).child({ step: 2 });
    log.info('hello', { extra: true });
    log.error('boom');
    expect(capture.entries).toEqual([
      { level: 'info', message: 'hello', planId: 'p1', step: 2, extra: true },
      { level: 'error', message: 'boom', planId: 'p1', step: 2 },
    ]);
  });

  it('meta cannot clobber level or message', () => {
    const { w, capture } = withLevels(winston.config.npm.levels, 'debug');
    const log = fromWinston(w);
    log.info('real', { level: 'error', message: 'fake' });
    expect(capture.entries).toEqual([{ level: 'info', message: 'real' }]);
  });

  it('normalizes Error values in meta so json formats keep the stack', () => {
    const { w, capture } = withLevels(winston.config.npm.levels, 'debug');
    fromWinston(w).error('failed', { error: new Error('kaboom') });
    expect(capture.entries[0].error).toMatchObject({ name: 'Error', message: 'kaboom' });
    expect(JSON.parse(JSON.stringify(capture.entries[0])).error.stack).toContain('kaboom');
  });

  it('rejects a levels table lacking warn/warning at construction time', () => {
    const { w } = withLevels({ error: 0, info: 1, debug: 2 }, 'debug');
    expect(() => fromWinston(w)).toThrow(UnsupportedWinstonLevelsError);
  });
});

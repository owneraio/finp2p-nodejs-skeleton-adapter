import * as winston from 'winston';
import {
  Log, fromSink, isLevel, isLog, silentLog,
} from '../src';

describe('Log brand', () => {
  it('only factories produce a Log', () => {
    // @ts-expect-error winston.Logger has warn AND warning but no brand
    const fromRaw: Log = winston.createLogger();
    // @ts-expect-error a structurally matching literal is not a Log either
    const fromLiteral: Log = {
      debug() {}, info() {}, warn() {}, error() {}, child() { return this; },
    };
    const ok: Log = silentLog();
    expect([fromRaw, fromLiteral, ok]).toHaveLength(3);
  });

  it('brand is a string key set at runtime: survives a spread, isLog() guards', () => {
    const spread: Log = { ...silentLog() };
    expect(isLog(spread)).toBe(true);
    expect(isLog(winston.createLogger())).toBe(false);
    expect(isLog(null)).toBe(false);
  });

  it('fromSink forwards level, message and merged meta', () => {
    const sink = jest.fn();
    fromSink(sink, { base: { base: 1 } }).child({ c: 2 }).warn('m', { m: 3 });
    expect(sink).toHaveBeenCalledWith('warn', 'm', { base: 1, c: 2, m: 3 });
  });

  it('isLevel guards env input', () => {
    expect(isLevel('warn')).toBe(true);
    expect(isLevel('warning')).toBe(false);
    expect(isLevel(undefined)).toBe(false);
  });

  it('exposes no warning/alert/notice methods', () => {
    const log = silentLog() as unknown as Record<string, unknown>;
    expect(log.warning).toBeUndefined();
    expect(log.alert).toBeUndefined();
    expect(log.notice).toBeUndefined();
  });
});

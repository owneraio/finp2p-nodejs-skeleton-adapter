import * as winston from 'winston';
import {
  Log, fromSink, isLevel, silentLog,
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

  it('fromSink forwards level, message and merged meta', () => {
    const sink = jest.fn();
    fromSink(sink, { base: 1 }).child({ c: 2 }).warn('m', { m: 3 });
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

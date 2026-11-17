import * as winston from 'winston';
import {
  Meta, REDACTED, fromConsole, fromSink, silentLog, withRedaction,
} from '../src';
import { fromWinston } from '../src/winston';

const counting = () => {
  const reads = { count: 0 };
  const meta = { get value() { reads.count += 1; return 1; } };
  return { reads, meta };
};

describe('a log call never throws', () => {
  it('bad meta degrades to message + logError, still redacted', () => {
    const sink = jest.fn();
    const meta = { get boom(): never { throw new Error('getter s3cr3t'); } };
    fromSink(sink, { redact: { secrets: ['s3cr3t'] } }).info('s3cr3t here', meta);
    expect(sink).toHaveBeenCalledWith('info', `${REDACTED} here`, { logError: `getter ${REDACTED}` });
  });

  it('revoked proxies and throwing collections degrade too', () => {
    const sink = jest.fn();
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const result = Object.assign([1], { map: () => { throw new Error('deferred decode error'); } });
    fromSink(sink).info('a', { proxy });
    fromSink(sink).info('b', { result });
    expect(sink.mock.calls.map(([, message, meta]) => [message, Object.keys(meta)]))
      .toEqual([['a', ['logError']], ['b', ['logError']]]);
  });

  it('a throwing sink is swallowed', () => {
    const log = fromSink(() => { throw new Error('disk full'); });
    expect(() => log.error('x')).not.toThrow();
  });
});

describe('disabled levels never touch meta', () => {
  it.each<[string, (meta: Meta) => void]>([
    ['fromSink', (meta) => fromSink(jest.fn(), { isLevelEnabled: (level) => level !== 'debug' }).debug('x', meta)],
    ['fromConsole', (meta) => fromConsole({ level: 'info' }).debug('x', meta)],
    ['fromWinston', (meta) => fromWinston(winston.createLogger({ level: 'info' })).debug('x', meta)],
    ['silentLog', (meta) => silentLog().child(meta).error('x', meta)],
    ['withRedaction', (meta) => withRedaction(fromConsole({ level: 'info' })).debug('x', meta)],
  ])('%s', (_, call) => {
    const { reads, meta } = counting();
    call(meta);
    expect(reads.count).toBe(0);
  });
});

describe('log.isLevelEnabled(level)', () => {
  it('answers with the gate the log itself uses; child and withRedaction inherit it', () => {
    const log = fromConsole({ level: 'info' });
    expect([log.isLevelEnabled('debug'), log.isLevelEnabled('info')]).toEqual([false, true]);
    expect(log.child({ a: 1 }).isLevelEnabled('debug')).toBe(false);
    expect(withRedaction(log).isLevelEnabled('debug')).toBe(false);
    expect(fromWinston(winston.createLogger({ level: 'warn' })).isLevelEnabled('info')).toBe(false);
    expect(silentLog().isLevelEnabled('error')).toBe(false);
  });
});

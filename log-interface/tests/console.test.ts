import { fromConsole } from '../src/console';

const target = () => ({
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
});

describe('fromConsole', () => {
  it('defaults to info threshold, pretty format', () => {
    const t = target();
    const log = fromConsole({ target: t });
    log.debug('nope');
    log.info('hi');
    log.warn('w', { a: 1 });
    expect(t.debug).not.toHaveBeenCalled();
    expect(t.info).toHaveBeenCalledWith('[INFO]', 'hi');
    expect(t.warn).toHaveBeenCalledWith('[WARN]', 'w', { a: 1 });
  });

  it('json format emits one object per line with child meta merged', () => {
    const t = target();
    const log = fromConsole({ target: t, format: 'json', level: 'debug' }).child({ svc: 'x' });
    log.error('bad', { err: new Error('kaboom') });
    const line = JSON.parse(t.error.mock.calls[0][0]);
    expect(line).toMatchObject({ level: 'error', msg: 'bad', svc: 'x', err: { name: 'Error', message: 'kaboom' } });
    expect(typeof line.time).toBe('string');
  });

  it('json never throws: bigint, plain and class-instance cycles, shared refs', () => {
    const t = target();
    class Ring { next?: Ring; }
    const ring = new Ring();
    ring.next = ring;
    const plain: Record<string, unknown> = { v: 1 };
    plain.self = plain;
    const shared = { v: 2 };
    fromConsole({ target: t, format: 'json' }).info('x', {
      balance: 10n, ring, plain, a: shared, b: shared,
    });
    expect(JSON.parse(t.info.mock.calls[0][0])).toMatchObject({
      balance: '10', ring: { next: '[circular]' }, plain: { v: 1, self: '[circular]' }, a: { v: 2 }, b: { v: 2 },
    });
  });

  it('json: meta cannot clobber level/msg', () => {
    const t = target();
    fromConsole({ target: t, format: 'json' }).info('real', { level: 'error', msg: 'fake' });
    expect(JSON.parse(t.info.mock.calls[0][0])).toMatchObject({ level: 'info', msg: 'real' });
  });
});

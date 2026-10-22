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

  it('json: meta cannot clobber level/msg', () => {
    const t = target();
    fromConsole({ target: t, format: 'json' }).info('real', { level: 'error', msg: 'fake' });
    expect(JSON.parse(t.info.mock.calls[0][0])).toMatchObject({ level: 'info', msg: 'real' });
  });
});

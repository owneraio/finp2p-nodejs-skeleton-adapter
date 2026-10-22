import {
  fromSink, redactMeta, redactText, secretsFromEnv, withRedaction, REDACTED,
} from '../src';

describe('redactText', () => {
  it.each([
    ['RPC_URL=https://user:password@example.com/', `RPC_URL=https://${REDACTED}@example.com/`],
    ['connect postgres://u:p@db:5432/x failed', `connect postgres://${REDACTED}@db:5432/x failed`],
    ['https://token@host/path', `https://${REDACTED}@host/path`],
    ['https://example.com/no-creds', 'https://example.com/no-creds'],
    ['Authorization: Bearer eyJhbGciOi.abc_def-ghi==', `Authorization: Bearer ${REDACTED}`],
    ['basic dXNlcjpwYXNz', `basic ${REDACTED}`],
    ['DB_PASSWORD=hunter2 LOG_LEVEL=debug', `DB_PASSWORD=${REDACTED} LOG_LEVEL=debug`],
    ['{"apiKey":"k-123","tokenId":"t-1"}', `{"apiKey":"${REDACTED}","tokenId":"t-1"}`],
    ['privateKey: 0xabc tokenAddress: 0xdef', `privateKey: ${REDACTED} tokenAddress: 0xdef`],
    ['SIGNER_PRIVATE_KEY=0xabc', `SIGNER_PRIVATE_KEY=${REDACTED}`],
    ['-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----', REDACTED],
  ])('%s', (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it('erases literal secrets, longest first', () => {
    const secrets = ['abc', 'abcdef'].sort((a, b) => b.length - a.length);
    expect(redactText('x abcdef y abc', { secrets })).toBe(`x ${REDACTED} y ${REDACTED}`);
  });

  it('applies custom keys and patterns', () => {
    expect(redactText('finId=f1 otp=1234 ssn 123-45-6789', { keys: ['otp'], patterns: [/\d{3}-\d{2}-\d{4}/g] }))
      .toBe(`finId=f1 otp=${REDACTED} ssn ${REDACTED}`);
  });
});

describe('redactMeta', () => {
  it('erases secret keys and redacts nested strings, leaves other values alone', () => {
    const meta = {
      password: 'p', tokenId: 't-1', rpcUrl: 'https://u:p@h', nested: { API_KEY: { k: 1 }, list: ['Bearer x', 42] }, when: new Date(0),
    };
    expect(redactMeta(meta)).toEqual({
      password: REDACTED,
      tokenId: 't-1',
      rpcUrl: `https://${REDACTED}@h`,
      nested: { API_KEY: REDACTED, list: [`Bearer ${REDACTED}`, 42] },
      when: new Date(0),
    });
  });

  it('survives cycles', () => {
    const a: Record<string, unknown> = { s: 'x' };
    a.self = a;
    expect(redactMeta(a)).toEqual({ s: 'x', self: '[circular]' });
  });
});

describe('secretsFromEnv', () => {
  it('collects values of secret-looking keys, plus JSON-escaped forms', () => {
    const env = {
      DB_PASSWORD: 'a"b', NETWORK_AUTH: 'n', LOG_LEVEL: 'debug', RPC_URL: 'https://x', EMPTY_SECRET: '',
    };
    expect(secretsFromEnv(env)).toEqual(['a\\"b', 'a"b', 'n']);
  });
});

describe('withRedaction', () => {
  it('redacts message and meta, including normalized errors, before the inner log', () => {
    const sink = jest.fn();
    const log = withRedaction(fromSink(sink), { secrets: ['s3cr3t'] });
    log.error('RPC_URL=https://user:s3cr3t@example.com/ failed', {
      error: new Error('auth s3cr3t rejected'),
      config: { rpcUrl: 'https://user:s3cr3t@example.com/', privateKey: '0x1' },
    });
    const [level, message, meta] = sink.mock.calls[0];
    expect(level).toBe('error');
    expect(message).toBe(`RPC_URL=https://${REDACTED}@example.com/ failed`);
    expect(meta.error.message).toBe(`auth ${REDACTED} rejected`);
    expect(meta.config).toEqual({ rpcUrl: `https://${REDACTED}@example.com/`, privateKey: REDACTED });
  });

  it('child meta is redacted too', () => {
    const sink = jest.fn();
    withRedaction(fromSink(sink)).child({ apiKey: 'k' }).info('hi');
    expect(sink.mock.calls[0][2]).toEqual({ apiKey: REDACTED });
  });
});

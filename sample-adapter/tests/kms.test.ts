// KMS sealer against the ministack emulator: the descriptor publishes the KMS
// public key, plaintext secrets are refused, secrets sealed by the browser
// code path (headless/seal-lib.mjs) and by headless/seal.mjs are opened.
import * as http from 'http';
import { AddressInfo } from 'net';
import { execFile } from 'node:child_process';
import path from 'path';
import { Wallet } from 'ethers';
import { config } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import createApp from '../src/app';

const MINISTACK = 'http://localhost:4566';
const KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba';
const KEY2 = '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a';
const HEADLESS_DIR = path.join(__dirname, '..', 'headless');

const ministackUp = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${MINISTACK}/_ministack/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
};

const run = (args: string[], input?: string) => new Promise<string>((resolve, reject) => {
  const child = execFile(process.execPath, args, { cwd: HEADLESS_DIR }, (err, stdout, stderr) => {
    if (err) reject(new Error(`${err.message}\n${stderr}`));
    else resolve(stdout);
  });
  if (input !== undefined) child.stdin?.end(input);
});

/**
 * Seal through headless/seal-lib.mjs (WebCrypto, the exact code the browser
 * runs). ts-jest turns `import()` into require, which cannot load an .mjs, so
 * the module runs in a child node process instead.
 */
const sealWithLib = async (encryption: config.EncryptionInfo, value: string): Promise<config.SealedValue> => {
  const script = `
    import { sealSecret } from ${JSON.stringify(path.join(HEADLESS_DIR, 'seal-lib.mjs'))};
    const [enc, value] = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(await sealSecret(enc, value)));
  `;
  const out = await run(['--input-type=module', '-e', script, JSON.stringify([encryption, value])]);
  return JSON.parse(out);
};

describe('kms sealer (ministack)', () => {
  let available = false;
  let server: http.Server | undefined;
  let baseUrl = '';
  let app: ReturnType<typeof createApp> | undefined;

  beforeAll(async () => {
    available = await ministackUp();
    if (!available) {
      console.log(`kms tests skipped: ${MINISTACK}/_ministack/health not reachable`);
      return;
    }
    const sealer = new config.KmsSealer({
      keyId: 'alias/adapter-config',
      endpoint: MINISTACK,
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    app = createApp('my-org', undefined, { sealer, requireSealedSecrets: true, adapterId: 'kms-sample' });
    await new Promise<void>((resolve) => {
      server = app!.app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const post = async (p: string, body: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${baseUrl}${p}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const descriptor = async (): Promise<config.ConfigDescriptor> => (await fetch(`${baseUrl}/config`)).json() as Promise<config.ConfigDescriptor>;

  test('descriptor publishes the KMS key, plaintext secrets are refused', async () => {
    if (!available) return;
    const d = await descriptor();
    expect(d.adapter.id).toBe('kms-sample');
    expect(d.encryption).toMatchObject({ provider: 'kms', required: true, alg: 'RSA-OAEP-256+A256GCM' });
    expect(d.encryption?.kid).toMatch(/^arn:aws:kms:us-east-1:\d+:key\//);
    expect(d.encryption?.publicKey.length).toBeGreaterThan(100);

    const res = await post('/config/apply', {
      id: 'eip155:1', values: { LEDGER_KIND: 'evm', RPC_URL: 'http://127.0.0.1:1', CHAIN_ID: 1, OPERATOR_PRIVATE_KEY: KEY },
    });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([expect.objectContaining({ path: 'OPERATOR_PRIVATE_KEY', code: 'secret-must-be-sealed' })]);
    expect(JSON.stringify(res.body)).not.toContain(KEY.slice(2));
  });

  test('secret sealed by the browser code path is opened through KMS Decrypt', async () => {
    if (!available) return;
    const { encryption } = await descriptor();
    const sealed = await sealWithLib(encryption!, KEY);
    expect(sealed).toMatchObject({ enc: 'RSA-OAEP-256+A256GCM', kid: encryption!.kid });

    // evm needs a reachable rpc for the checks; the inmemory kind hides the evm page, so test the
    // seal/open path with the evm page visible and a tiny rpc stub
    const rpc = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }));
    });
    await new Promise<void>((resolve) => { rpc.listen(0, '127.0.0.1', resolve); });
    const rpcUrl = `http://127.0.0.1:${(rpc.address() as AddressInfo).port}`;
    try {
      const res = await post('/config/apply', {
        id: 'eip155:1',
        values: {
          LEDGER_KIND: 'evm', RPC_URL: rpcUrl, CHAIN_ID: 1, OPERATOR_PRIVATE_KEY: sealed,
        },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, state: 'configured' });
      expect(JSON.stringify(res.body)).not.toContain(KEY.slice(2));
      expect(app!.handler.connections.get('eip155:1')?.operatorAddress).toBe(new Wallet(KEY).address);

      // headless/seal.mjs: fetches the descriptor itself and prints { values } ready to POST
      const out = await run([path.join(HEADLESS_DIR, 'seal.mjs'), baseUrl, `OPERATOR_PRIVATE_KEY=${KEY2}`]);
      const body = JSON.parse(out);
      expect(body.values.OPERATOR_PRIVATE_KEY.kid).toBe(encryption!.kid);
      const res2 = await post('/config/apply', { id: 'eip155:1', values: body.values });
      expect(res2.status).toBe(200);
      expect(res2.body).toMatchObject({ ok: true, state: 'configured', version: 2 });
      expect(app!.handler.connections.get('eip155:1')?.operatorAddress).toBe(new Wallet(KEY2).address);
    } finally {
      rpc.close();
    }
  });
});

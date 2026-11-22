// Headless config flow against the running test app: descriptor, sealed
// secrets, live checks, per-network resolution, delete guard, restore on restart.
import * as http from 'http';
import { AddressInfo } from 'net';
import { Wallet } from 'ethers';
import { Pool } from 'pg';
import { config, workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import createApp from '../src/app';
import { SampleConfigHandler } from '../src/headless/handler';

interface Headless {
  runtime: config.ConfigRuntime;
  handler: SampleConfigHandler;
  connectionString: string;
  schemaName: string;
}

const g = global as unknown as { serverBaseAddress: string; headless: Headless };

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const EXPECTED_ADDRESS = new Wallet(KEY).address;
const RPC_AUTH = 'alice:s3cret';
const ANVIL_CHAIN_ID = 31337;
const ANVIL = `eip155:${ANVIL_CHAIN_ID}`;

/** Minimal JSON-RPC server: answers eth_chainId and records the auth header. */
const startFakeRpc = (chainId: number) => {
  const seen: { authorization?: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ authorization: req.headers.authorization });
      const { id, method } = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      if (method === 'eth_chainId') res.end(JSON.stringify({ jsonrpc: '2.0', id, result: `0x${chainId.toString(16)}` }));
      else res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } }));
    });
  });
  return new Promise<{ url: string; seen: typeof seen; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, seen, close: () => server.close() });
    });
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const api = {
  async get(path: string): Promise<{ status: number; body: Json }> {
    const res = await fetch(`${g.serverBaseAddress}${path}`);
    return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
  },
  async post(path: string, body: unknown): Promise<{ status: number; body: Json }> {
    const res = await fetch(`${g.serverBaseAddress}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `${Date.now()}-${Math.random()}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
  },
  async del(path: string): Promise<{ status: number; body: Json }> {
    const res = await fetch(`${g.serverBaseAddress}${path}`, { method: 'DELETE' });
    return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
  },
};

const descriptor = async (): Promise<config.ConfigDescriptor> => (await api.get('/config')).body;
const configOf = (d: config.ConfigDescriptor, id: string) => d.configs.find((c) => c.kind === 'network' && c.id === id);

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

/** Follow an operation until it completes. */
const follow = async (first: Json) => {
  let op: Json = first;
  for (let i = 0; i < 100 && !op.isCompleted; i += 1) {
    await sleep(200);
    op = (await api.get(`/api/operations/status/${op.cid}`)).body.operation;
  }
  return op;
};

/** POST /api/assets/create and follow the operation until it completes. */
const createAsset = async (assetId: string, binding?: { network: string; standard: string }) => {
  const { body } = await api.post('/api/assets/create', {
    asset: { resourceId: assetId },
    ...(binding ? { ledgerAssetBinding: { assetIdentifierType: 'CAIP-19', ...binding } } : {}),
  });
  return follow(body);
};

const issue = async (assetId: string, finId: string, quantity: string) => {
  const { body } = await api.post('/api/assets/issue', {
    quantity, destination: { finId, asset: { type: 'finp2p', resourceId: assetId } },
  });
  return follow(body);
};

describe('headless config', () => {
  let rpc: Awaited<ReturnType<typeof startFakeRpc>>;

  beforeAll(async () => {
    rpc = await startFakeRpc(ANVIL_CHAIN_ID);
  });

  afterAll(() => rpc.close());

  test('descriptor: protocol, default inmemory network, local encryption', async () => {
    const d = await descriptor();
    expect(d.protocol).toBe('adapter-config/2');
    expect(d.adapter.kind).toBe('@owneraio/sample-adapter');
    expect(d.pages.map((p) => [p.id, p.kind ?? 'network'])).toEqual([['ledger', 'network'], ['evm', 'network']]);
    expect(configOf(d, 'inmemory')).toMatchObject({ kind: 'network', state: 'configured', isDefault: true });
    expect(d.encryption).toMatchObject({ alg: 'RSA-OAEP-256+A256GCM', provider: 'local', required: false });
    expect(d.encryption?.kid).toMatch(/^local:/);
    expect(d.readiness.ready).toBe(true);
  });

  test('apply an evm network with sealed secrets: checks pass, secret never leaks, rpc saw basic auth', async () => {
    const { encryption } = await descriptor();
    const seal = (v: string) => config.sealWithPublicKey(encryption!.publicKey, encryption!.kid, v);
    const res = await api.post('/config/apply', {
      id: ANVIL,
      name: 'anvil',
      values: {
        LEDGER_KIND: 'evm',
        RPC_URL: rpc.url,
        CHAIN_ID: ANVIL_CHAIN_ID,
        OPERATOR_PRIVATE_KEY: seal(KEY),
        RPC_AUTH: seal(RPC_AUTH),
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, kind: 'network', id: ANVIL, state: 'configured', version: 1 });
    const checks = Object.fromEntries(res.body.checks.map((c: config.ConfigCheck) => [c.id, c]));
    expect(checks.rpc).toMatchObject({ ok: true });
    expect(checks['operator-key']).toMatchObject({ ok: true, message: EXPECTED_ADDRESS });
    expect(checks['ledger-id']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(KEY.slice(2));
    expect(JSON.stringify(res.body)).not.toContain(RPC_AUTH);

    const d = await descriptor();
    expect(JSON.stringify(d)).not.toContain(KEY.slice(2));
    expect(JSON.stringify(d)).not.toContain(RPC_AUTH);
    expect(configOf(d, ANVIL)).toMatchObject({
      state: 'configured',
      name: 'anvil',
      values: { LEDGER_KIND: 'evm', OPERATOR_PRIVATE_KEY: { set: true }, RPC_AUTH: { set: true } },
    });

    expect(rpc.seen.length).toBeGreaterThan(0);
    expect(rpc.seen[0].authorization).toBe(`Basic ${Buffer.from(RPC_AUTH).toString('base64')}`);
    expect(g.headless.handler.connections.get(ANVIL)).toMatchObject({
      kind: 'evm', network: ANVIL, chainId: ANVIL_CHAIN_ID, operatorAddress: EXPECTED_ADDRESS,
    });
  });

  test('wrong CHAIN_ID -> 422 with failing rpc and ledger-id checks, nothing stored', async () => {
    const res = await api.post('/config/apply', {
      id: 'eip155:1',
      values: {
        LEDGER_KIND: 'evm', RPC_URL: rpc.url, CHAIN_ID: 5, OPERATOR_PRIVATE_KEY: KEY,
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    const ids = res.body.checks.filter((c: config.ConfigCheck) => !c.ok).map((c: config.ConfigCheck) => c.id).sort();
    expect(ids).toEqual(['ledger-id', 'rpc']);
    expect(JSON.stringify(res.body)).not.toContain(KEY.slice(2));
    expect(configOf(await descriptor(), 'eip155:1')).toBeUndefined();
  });

  test('an evm ledger must be named eip155:<chainId>', async () => {
    const res = await api.post('/config/apply', {
      id: 'anvil-local',
      values: { LEDGER_KIND: 'evm', RPC_URL: rpc.url, CHAIN_ID: ANVIL_CHAIN_ID, OPERATOR_PRIVATE_KEY: KEY },
    });
    expect(res.status).toBe(422);
    expect(res.body.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'ledger-id', ok: false })]));
    expect((await api.post('/config/apply', { values: { LEDGER_KIND: 'inmemory' } })).status).toBe(400);
    expect((await api.post('/config/apply', { id: 'has space', values: { LEDGER_KIND: 'inmemory' } })).status).toBe(400);
  });

  test('createAsset on a configured ledger records that ledger on the asset', async () => {
    const op = await createAsset('asset-anvil-1', { network: ANVIL, standard: 'ERC20' });
    expect(op.error).toBeUndefined();
    expect(op.response.ledgerAssetInfo.ledgerIdentifier.network).toBe(ANVIL);
  });

  test('createAsset without a binding lands on the default network', async () => {
    const op = await createAsset('asset-default-1');
    expect(op.error).toBeUndefined();
    expect(op.response.ledgerAssetInfo.ledgerIdentifier.network).toBe('inmemory');
  });

  test('createAsset on an unconfigured ledger -> 7311', async () => {
    const op = await createAsset('asset-mainnet-1', { network: 'eip155:1', standard: 'ERC20' });
    expect(op.error).toMatchObject({ code: 7311 });
    expect(op.error.message).toContain('eip155:1');
  });

  test('ledger down: operations on its assets fail, they never run on another ledger', async () => {
    const { handler } = g.headless;
    const ok = await issue('asset-anvil-1', 'fin-1', '10');
    expect(ok.error).toBeUndefined();

    const realActivate = handler.activate.bind(handler);
    handler.activate = async () => { throw new Error('rpc down'); };
    try {
      const broken = await api.post('/config/apply', { id: ANVIL, values: { LABEL: 'broken' } });
      expect(broken.status).toBe(500);
      expect(broken.body).toMatchObject({ ok: false, state: 'error' });
      expect(handler.connections.has(ANVIL)).toBe(false);

      const op = await issue('asset-anvil-1', 'fin-1', '10');
      expect(op.error).toMatchObject({ code: 7311 });
      expect(op.error.message).toContain(ANVIL);
      expect(op.error.message).toContain('error');
      // the default ledger is untouched and still serves its own assets
      expect((await issue('asset-default-1', 'fin-1', '10')).error).toBeUndefined();
      // and new assets cannot be created on the broken ledger
      expect((await createAsset('asset-anvil-2', { network: ANVIL, standard: 'ERC20' })).error).toMatchObject({ code: 7311 });
    } finally {
      handler.activate = realActivate;
    }
    const fixed = await api.post('/config/apply', { id: ANVIL, values: { LABEL: 'fixed' } });
    expect(fixed.status).toBe(200);
    expect((await issue('asset-anvil-1', 'fin-1', '10')).error).toBeUndefined();
  });

  test('the /config body limit holds even though the app has a larger global json parser', async () => {
    const res = await api.post('/config/apply', { id: 'huge', values: { LABEL: 'x'.repeat(2 * 1024 * 1024) } });
    expect(res.status).toBe(413);
    expect(configOf(await descriptor(), 'huge')).toBeUndefined();
  });

  test('credential headers never reach the request log', async () => {
    const { stdout } = process;
    const chunks: string[] = [];
    const original = stdout.write.bind(stdout);
    stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(String(chunk));
      return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stdout.write;
    try {
      const headers = { authorization: 'Bearer TOKEN-SECRET', cookie: 'session=COOKIE-SECRET', 'x-api-key': 'APIKEY-SECRET', 'x-actor': 'bob' };
      await fetch(`${g.serverBaseAddress}/health`, { headers });
      await fetch(`${g.serverBaseAddress}/config`, { headers });
      await sleep(100);
    } finally {
      stdout.write = original as typeof stdout.write;
    }
    const log = chunks.join('');
    expect(log).toContain('/health');   // proves the capture saw the request log line
    for (const secret of ['TOKEN-SECRET', 'COOKIE-SECRET', 'APIKEY-SECRET']) expect(log).not.toContain(secret);
  });

  test('delete: 409 while assets live on the ledger, 204 for an empty one', async () => {
    const inUse = await api.del(`/config/network/${ANVIL}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body.error).toContain('asset-anvil-1');
    const applied = await api.post('/config/apply', { id: 'inmemory:spare', values: { LEDGER_KIND: 'inmemory' } });
    expect(applied.status).toBe(200);
    expect((await api.del('/config/network/inmemory:spare')).status).toBe(204);
    expect((await api.del('/config/network/inmemory:spare')).status).toBe(404);
    expect((await api.del('/config/asset/inmemory')).status).toBe(400);
    expect((await descriptor()).configs.map((c) => c.id).sort()).toEqual([ANVIL, 'inmemory']);
  });

  test('restart: a second app on the same DB restores both networks and opens the sealed secret', async () => {
    const { connectionString, schemaName } = g.headless;
    const pool = new Pool({ connectionString });
    try {
      const store = new config.PgConfigStore(pool, schemaName);
      const sealer = await config.LocalRsaSealer.create(store);
      const second = createApp('my-org', undefined, { pool, schemaName, sealer });
      await second.restored;
      const d = await second.runtime.describe();
      expect(d.encryption?.kid).toBe((await descriptor()).encryption?.kid);
      expect(configOf(d, 'inmemory')).toMatchObject({ state: 'configured', isDefault: true });
      expect(configOf(d, ANVIL)).toMatchObject({ state: 'configured', name: 'anvil' });
      expect(second.runtime.networks().sort()).toEqual([ANVIL, 'inmemory']);
      expect(second.handler.connections.get(ANVIL)?.operatorAddress).toBe(EXPECTED_ADDRESS);
      expect(second.runtime.readiness().ready).toBe(true);
    } finally {
      await pool.end();
    }
  });

  test('restart: a pending operation is replayed only after the stored configs are back', async () => {
    const { connectionString, schemaName, runtime } = g.headless;
    const { encryption } = await descriptor();
    // a config with a sealed secret, so restoring it costs a sealer round trip
    const applied = await runtime.apply({
      id: 'inmemory:slow',
      values: {
        LEDGER_KIND: 'inmemory',
        OPERATOR_PRIVATE_KEY: config.sealWithPublicKey(encryption!.publicKey, encryption!.kid, KEY),
      },
    });
    expect(applied.ok).toBe(true);

    const pool = new Pool({ connectionString });
    try {
      const storage = new workflows.WorkflowStorage(pool, schemaName);
      const cid = `replay-${Date.now()}`;
      await storage.saveOperation({
        cid,
        method: 'createAsset',
        status: 'in_progress',
        inputs: ['ik-replay', 'asset-replay-1', { assetIdentifierType: 'CAIP-19', network: 'inmemory:slow', standard: 'mock' }, null, null, null, null],
        outputs: { cid, isCompleted: false },
      });

      const store = new config.PgConfigStore(pool, schemaName);
      const real = await config.LocalRsaSealer.create(store);
      // KMS-like latency: the restore of 'inmemory:slow' finishes well after the replay would have started
      const sealer: config.Sealer = {
        provider: real.provider,
        kid: () => real.kid(),
        publicKey: () => real.publicKey(),
        unwrapKey: async (w, k) => { await sleep(300); return real.unwrapKey(w, k); },
      };
      const second = createApp('my-org', undefined, { pool, schemaName, sealer });
      await second.restored;
      expect(second.runtime.resolve('inmemory:slow')).toBeDefined();
      let op = await storage.getOperationByCid(cid);
      for (let i = 0; i < 50 && op?.status === 'in_progress'; i += 1) {
        await sleep(100);
        op = await storage.getOperationByCid(cid);
      }
      expect(op?.status).toBe('succeeded');
      expect(JSON.stringify(op?.outputs)).toContain('inmemory:slow');
    } finally {
      await pool.end();
    }
  });
});

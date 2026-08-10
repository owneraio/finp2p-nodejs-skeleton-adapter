import express, { Application } from 'express'
import { Server } from 'http'
import axios from 'axios'
import { registerWhitelistRoutes } from '../../src/routes/operational'
import { InvestorWhitelistEntry, InvestorWhitelistService, ValidationError } from '../../src/models'

class InMemoryWhitelist implements InvestorWhitelistService {
  entries = new Map<string, InvestorWhitelistEntry>();

  private key(finId: string, assetId: string) { return `${finId}|${assetId}`; }

  async whitelist(finId: string, assetId: string, config: Record<string, unknown>) {
    const entry = { finId, assetId, config };
    this.entries.set(this.key(finId, assetId), entry);
    return entry;
  }

  async dewhitelist(finId: string, assetId?: string) {
    let removed = 0;
    for (const [k, e] of [...this.entries]) {
      if (e.finId === finId && (assetId === undefined || e.assetId === assetId)) {
        this.entries.delete(k);
        removed++;
      }
    }
    return removed;
  }

  async getWhitelist(finId?: string, assetId?: string) {
    return [...this.entries.values()].filter(e =>
      (finId === undefined || e.finId === finId) && (assetId === undefined || e.assetId === assetId));
  }

  async isWhitelisted(finId: string, assetId: string) {
    return this.entries.has(this.key(finId, assetId));
  }
}

describe("investor whitelist routes", () => {
  let server: Server;
  let base: string;
  let service: InMemoryWhitelist;

  const FIN = "02a1b2c3";
  const ASSET = "bank-x:102:asset-1";

  const start = (app: Application) => new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });

  beforeEach(async () => {
    service = new InMemoryWhitelist();
    const app = express();
    app.use(express.json());
    registerWhitelistRoutes(app, service);
    await start(app);
  });

  afterEach(() => new Promise<void>(r => server.close(() => r())));


  // axios rather than global fetch: tsconfig lib is es2021, which has no fetch.
  // validateStatus keeps 4xx/5xx as ordinary responses so status can be asserted.
  const call = (method: string, url: string, data?: unknown) =>
    axios.request({ method, url: `${base}${url}`, data, validateStatus: () => true } as any)
      .then(r => ({ status: r.status, body: r.data }));

  const post = (body: unknown) => call('POST', '/whitelist/investors', body);
  const del = (query: string) => call('DELETE', `/whitelist/investors${query}`);
  const get = (query = '') => call('GET', `/whitelist/investors${query}`);

  test("POST whitelists and echoes the entry", async () => {
    const res = await post({ finId: FIN, assetId: ASSET, config: { tier: 'A' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ finId: FIN, assetId: ASSET, config: { tier: 'A' } });
    expect(await service.isWhitelisted(FIN, ASSET)).toBe(true);
  });

  test("POST defaults a missing config to empty", async () => {
    const res = await post({ finId: FIN, assetId: ASSET });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({});
  });

  test.each([
    ["missing finId", { assetId: ASSET }],
    ["missing assetId", { finId: FIN }],
    ["empty body", {}],
  ])("POST rejects %s with 400", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  test("POST rejects a non-hex finId with 400", async () => {
    const res = await post({ finId: 'not-hex!', assetId: ASSET });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hexadecimal/);
  });

  // The validator is a service concern; the route only has to map its
  // ValidationError to 400 instead of 500.
  test("a validator's ValidationError surfaces as 400, not 500", async () => {
    const app = express();
    app.use(express.json());
    registerWhitelistRoutes(app, {
      ...service,
      whitelist: async () => { throw new ValidationError('bad tier'); },
    } as unknown as InvestorWhitelistService);
    await new Promise<void>(r => server.close(() => r()));
    await start(app);

    const res = await post({ finId: FIN, assetId: ASSET, config: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad tier');
  });

  test("DELETE dewhitelists one pair and reports the count", async () => {
    await service.whitelist(FIN, ASSET, {});
    await service.whitelist(FIN, "bank-x:102:asset-2", {});

    const res = await del(`?finId=${FIN}&assetId=${encodeURIComponent(ASSET)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ finId: FIN, assetId: ASSET, removed: 1 });
    expect(await service.isWhitelisted(FIN, "bank-x:102:asset-2")).toBe(true);
  });

  // assetId is a resource id with colons, so it must survive URL encoding.
  test("DELETE without assetId removes all and omits assetId from the response", async () => {
    await service.whitelist(FIN, ASSET, {});
    await service.whitelist(FIN, "bank-x:102:asset-2", {});

    const { body } = await del(`?finId=${FIN}`);
    expect(body).toEqual({ finId: FIN, removed: 2 });
    expect('assetId' in body).toBe(false);
  });

  test("DELETE of an absent entry succeeds with removed=0", async () => {
    const res = await del('?finId=02ffff');
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(0);
  });

  test("DELETE requires finId", async () => {
    const res = await del('');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/finId is required/);
  });

  test("GET filters by finId and assetId", async () => {
    await service.whitelist(FIN, ASSET, { tier: 'A' });
    await service.whitelist(FIN, "bank-x:102:asset-2", { tier: 'B' });
    await service.whitelist("02ffff", ASSET, { tier: 'C' });

    expect((await get()).body).toHaveLength(3);
    expect((await get(`?finId=${FIN}`)).body).toHaveLength(2);
    expect((await get(`?finId=${FIN}&assetId=${encodeURIComponent(ASSET)}`)).body)
      .toEqual([{ finId: FIN, assetId: ASSET, config: { tier: 'A' } }]);
  });

  test("a service failure surfaces as 500", async () => {
    const app = express();
    app.use(express.json());
    registerWhitelistRoutes(app, {
      ...service,
      whitelist: async () => { throw new Error('db down'); },
    } as unknown as InvestorWhitelistService);
    await new Promise<void>(r => server.close(() => r()));
    await start(app);

    const res = await post({ finId: FIN, assetId: ASSET });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db down');
  });
});

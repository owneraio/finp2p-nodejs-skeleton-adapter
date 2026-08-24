import express, { Application } from 'express'
import { Server } from 'http'
import axios from 'axios'
import { registerWhitelistRoutes } from '../../src/routes/operational'
import {
  InvestorWhitelistEntry, InvestorWhitelistService, WhitelistParty, whitelistPartyId,
  ValidationError, WhitelistRefusedError,
} from '../../src/models'

class InMemoryWhitelist implements InvestorWhitelistService {
  entries = new Map<string, InvestorWhitelistEntry>();

  private key(party: WhitelistParty, assetId: string) {
    return `${party.type}|${whitelistPartyId(party)}|${assetId}`;
  }

  private same(a: WhitelistParty, b: WhitelistParty) {
    return a.type === b.type && whitelistPartyId(a) === whitelistPartyId(b);
  }

  async whitelist(party: WhitelistParty, assetId: string, config: Record<string, unknown>) {
    const entry = { party, assetId, config };
    this.entries.set(this.key(party, assetId), entry);
    return entry;
  }

  async dewhitelist(party: WhitelistParty, assetId?: string) {
    let removed = 0;
    for (const [k, e] of [...this.entries]) {
      if (this.same(e.party, party) && (assetId === undefined || e.assetId === assetId)) {
        this.entries.delete(k);
        removed++;
      }
    }
    return removed;
  }

  async getWhitelist(party?: WhitelistParty, assetId?: string) {
    return [...this.entries.values()].filter(e =>
      (party === undefined || this.same(e.party, party)) && (assetId === undefined || e.assetId === assetId));
  }

  async isWhitelisted(party: WhitelistParty, assetId: string) {
    return this.entries.has(this.key(party, assetId));
  }
}

describe("investor whitelist routes", () => {
  let server: Server;
  let base: string;
  let service: InMemoryWhitelist;

  const ASSET = "bank-x:102:asset-1";
  const FINID = "02a1b2c3";
  const FIN: WhitelistParty = { type: 'finId', finId: FINID };
  const ADDR: WhitelistParty = { type: 'address', address: "0xESCROW" };

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

  const post = (body: unknown) => call('POST', '/investor/whitelist', body);
  const del = (query: string) => call('DELETE', `/investor/whitelist${query}`);
  const get = (query = '') => call('GET', `/investor/whitelist${query}`);

  test("POST whitelists and echoes the entry", async () => {
    const res = await post({ finId: FINID, assetId: ASSET, config: { tier: 'A' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ finId: FINID, assetId: ASSET, config: { tier: 'A' } });
    expect(await service.isWhitelisted(FIN, ASSET)).toBe(true);
  });

  test("POST defaults a missing config to empty", async () => {
    const res = await post({ finId: FINID, assetId: ASSET });
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({});
  });

  test.each([
    ["missing party", { assetId: ASSET }],
    ["missing assetId", { finId: FINID }],
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

    const res = await post({ finId: FINID, assetId: ASSET, config: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad tier');
  });

  test("DELETE dewhitelists one pair and reports the count", async () => {
    await service.whitelist(FIN, ASSET, {});
    await service.whitelist(FIN, "bank-x:102:asset-2", {});

    const res = await del(`?finId=${FINID}&assetId=${encodeURIComponent(ASSET)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ finId: FINID, assetId: ASSET, removed: 1 });
    expect(await service.isWhitelisted(FIN, "bank-x:102:asset-2")).toBe(true);
  });

  // assetId is a resource id with colons, so it must survive URL encoding.
  test("DELETE without assetId removes all and omits assetId from the response", async () => {
    await service.whitelist(FIN, ASSET, {});
    await service.whitelist(FIN, "bank-x:102:asset-2", {});

    const { body } = await del(`?finId=${FINID}`);
    expect(body).toEqual({ finId: FINID, removed: 2 });
    expect('assetId' in body).toBe(false);
  });

  test("DELETE of an absent entry succeeds with removed=0", async () => {
    const res = await del('?finId=02ffff');
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(0);
  });

  test("DELETE requires a party", async () => {
    const res = await del('');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/finId or address is required/);
  });

  test("GET filters by finId and assetId", async () => {
    await service.whitelist(FIN, ASSET, { tier: 'A' });
    await service.whitelist(FIN, "bank-x:102:asset-2", { tier: 'B' });
    await service.whitelist(ADDR, ASSET, { tier: 'C' });

    expect((await get()).body).toHaveLength(3);
    expect((await get(`?finId=${FINID}`)).body).toHaveLength(2);
    expect((await get(`?finId=${FINID}&assetId=${encodeURIComponent(ASSET)}`)).body)
      .toEqual([{ finId: FINID, assetId: ASSET, config: { tier: 'A' } }]);
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

    const res = await post({ finId: FINID, assetId: ASSET });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db down');
  });

  test("POST accepts an address-only party (escrow wallet has no finId)", async () => {
    const res = await post({ address: '0xESCROW', assetId: ASSET, config: { role: 'escrow' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ address: '0xESCROW', assetId: ASSET, config: { role: 'escrow' } });
    expect(await service.isWhitelisted(ADDR, ASSET)).toBe(true);
  });

  test("POST rejects both finId and address with 400", async () => {
    const res = await post({ finId: FINID, address: '0xESCROW', assetId: ASSET });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exactly one/);
  });

  test("an address party is not hex-validated", async () => {
    const res = await post({ address: '0xNotHex!', assetId: ASSET });
    expect(res.status).toBe(200);
  });

  test("DELETE by address leaves the finId party alone", async () => {
    await service.whitelist(FIN, ASSET, {});
    await service.whitelist(ADDR, ASSET, {});

    const res = await del(`?address=0xESCROW&assetId=${encodeURIComponent(ASSET)}`);
    expect(res.body).toEqual({ address: '0xESCROW', assetId: ASSET, removed: 1 });
    expect(await service.isWhitelisted(FIN, ASSET)).toBe(true);
  });

  // A policy refusal must be distinguishable from an RPC outage, or operators
  // cannot tell "finish onboarding elsewhere" from "the adapter is broken".
  test("a WhitelistRefusedError surfaces as 409 with the blocking mechanisms", async () => {
    const app = express();
    app.use(express.json());
    registerWhitelistRoutes(app, {
      ...service,
      whitelist: async () => {
        throw new WhitelistRefusedError('party remains blocked', ['identityRegistry', 'countryRestriction']);
      },
    } as unknown as InvestorWhitelistService);
    await new Promise<void>(r => server.close(() => r()));
    await start(app);

    const res = await post({ finId: FINID, assetId: ASSET });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'party remains blocked',
      mechanisms: ['identityRegistry', 'countryRestriction'],
    });
  });
});

import express from 'express';
import { Server } from 'http';
import axios from 'axios';
import { register } from '../../src/routes/routes';
import { AssetNotFoundError, InstructionCapability, TokenService } from '../../src/models';

const CONTRACT = '0xAbC0000000000000000000000000000000000001';

const body = {
  asset: {
    type: 'finp2p',
    resourceId: 'bank-x:102:asset-1',
    ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network: 'eip155:1', standard: 'ERC20', tokenId: '0x01' },
  },
};

const listed: InstructionCapability[] = [
  {
    instruction: 'INSTRUCTION_TRANSFER',
    contracts: [{ address: CONTRACT, name: 'Transfer gate', restrictions: { minAmount: '1' } }, { address: 'custody-api' }],
  },
  { instruction: 'INSTRUCTION_ISSUE' },
];

const expectedListed = [
  {
    instruction: 'INSTRUCTION_TRANSFER',
    contracts: [{ address: CONTRACT, name: 'Transfer gate', restrictions: { minAmount: '1' } }, { address: 'custody-api' }],
  },
  { instruction: 'INSTRUCTION_ISSUE' },
];

const unused = {} as any;

describe('POST /api/assets/getCapabilities', () => {
  let server: Server;
  let base: string;

  const start = (tokenService: Partial<TokenService>) => new Promise<void>((resolve) => {
    const app = express();
    app.use(express.json());
    register(app, tokenService as TokenService, unused, unused, unused, unused, unused);
    server = app.listen(0, () => {
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });

  afterEach(() => new Promise<void>(r => server.close(() => r())));

  // axios rather than global fetch: tsconfig lib is es2021, which has no fetch.
  // validateStatus keeps 4xx/5xx as ordinary responses so status can be asserted.
  const call = () =>
    axios.post(`${base}/api/assets/getCapabilities`, body, { validateStatus: () => true })
      .then(r => ({ status: r.status, body: r.data }));

  const cases: { name: string; service: Partial<TokenService>; status: number; expected: unknown }[] = [
    {
      name: 'service without getCapabilities answers 501',
      service: {},
      status: 501,
      expected: { errors: [{ code: 0, message: 'asset capabilities are not supported by this adapter' }] },
    },
    {
      name: 'unknown asset answers 404',
      service: { getCapabilities: async () => { throw new AssetNotFoundError('no such asset'); } },
      status: 404,
      expected: { errors: [{ code: 0, message: 'no such asset' }] },
    },
    {
      name: 'listed capabilities keep contracts and restrictions, absent fields stay absent',
      service: { getCapabilities: async () => listed },
      status: 200,
      expected: { capabilities: expectedListed },
    },
    {
      name: 'empty list stays empty',
      service: { getCapabilities: async () => [] },
      status: 200,
      expected: { capabilities: [] },
    },
  ];

  test.each(cases)('$name', async ({ service, status, expected }) => {
    await start(service);
    const res = await call();
    expect(res.status).toBe(status);
    expect(res.body).toEqual(expected);
  });
});

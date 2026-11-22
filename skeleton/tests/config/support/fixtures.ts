// Shared schema + handler fakes for the config tests.
import {
  ActiveConfig, ConfigCheck, ConfigHandler, ConfigPage, ConfigRef, ConfigValues,
} from '../../../src/config';

export const SECRET = 'hunter2-super-secret-value';
export const RPC = 'https://rpc.example.test';

/** Network kind pages (default kind) plus one custody page. */
export const pages: ConfigPage[] = [
  {
    id: 'network',
    title: 'Network',
    fields: [
      { name: 'PROVIDER', label: 'Provider', type: 'enum', required: true, default: 'rpc', options: [{ value: 'rpc', label: 'RPC' }, { value: 'custody', label: 'Custody' }] },
      { name: 'RPC_URL', label: 'RPC URL', type: 'url', required: true, visibleWhen: { field: 'PROVIDER', equals: 'rpc' } },
      { name: 'RPC_AUTH', label: 'RPC auth', type: 'string', secret: true, visibleWhen: { field: 'PROVIDER', equals: 'rpc' } },
      { name: 'TIMEOUT_MS', label: 'Timeout', type: 'number', default: 5000, min: 100, max: 60000 },
      { name: 'VERBOSE', label: 'Verbose', type: 'boolean', default: false },
    ],
  },
  {
    id: 'keys',
    title: 'Keys',
    fields: [
      { name: 'OPERATOR_KEY', label: 'Operator key', type: 'hex', secret: true, required: true },
      { name: 'CONTRACT', label: 'Contract', type: 'address' },
      { name: 'TAG', label: 'Tag', type: 'string', pattern: '^[a-z]+$' },
    ],
  },
  {
    id: 'custody-ref',
    title: 'Custody',
    visibleWhen: { field: 'PROVIDER', in: ['custody'] },
    fields: [
      { name: 'CUSTODY_API_KEY', label: 'API key', type: 'string', secret: true, required: true },
    ],
  },
  {
    id: 'custody',
    kind: 'custody',
    title: 'Custodian',
    fields: [
      { name: 'VENDOR', label: 'Vendor', type: 'enum', required: true, options: [{ value: 'fireblocks', label: 'Fireblocks' }, { value: 'zodia', label: 'Zodia' }] },
      { name: 'API_KEY', label: 'API key', type: 'string', secret: true, required: true },
    ],
  },
];

/** Network-kind pages only, for adapters without a custodian. */
export const networkPages: ConfigPage[] = pages.filter((p) => !p.kind);

export const valid = { RPC_URL: RPC, OPERATOR_KEY: '0xabcdef' };
export const validCustody = { VENDOR: 'fireblocks', API_KEY: 'k' };

export const NET = 'eip155:1';
export const NET2 = 'eip155:5';
export const net = (id: string): ConfigRef => ({ kind: 'network', id });
export const custody = (id: string): ConfigRef => ({ kind: 'custody', id });

/** Account kind page: a per-wallet RPC credential (the per-investor connection). */
export const accountPage: ConfigPage = {
  id: 'account',
  kind: 'account',
  title: 'Account connection',
  fields: [
    { name: 'AUTH', label: 'Auth', type: 'enum', required: true, options: [{ value: 'bearer', label: 'Bearer token' }, { value: 'dtcc-wallet', label: 'DTCC wallet token' }] },
    { name: 'TOKEN', label: 'Token', type: 'string', secret: true, required: true, visibleWhen: { field: 'AUTH', equals: 'bearer' } },
  ],
};

export const pagesWithAccount: ConfigPage[] = [...pages, accountPage];

export const ADDR = '0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb';
export const account = (id: string): ConfigRef => ({ kind: 'account', id });

export interface FakeHandler extends ConfigHandler {
  activated: ActiveConfig[];
  deactivated: ConfigRef[];
  checksResult: ConfigCheck[];
  checkCalls: Array<{ ref: ConfigRef; values: ConfigValues; secrets: ConfigValues }>;
  failActivate?: Error;
  /** ids reported in use by `inUse` */
  used: Set<string>;
}

export const fakeHandler = (opts: { checks?: ConfigCheck[]; withCheck?: boolean } = {}): FakeHandler => {
  const h: FakeHandler = {
    activated: [],
    deactivated: [],
    checkCalls: [],
    checksResult: opts.checks ?? [{ id: 'rpc', label: 'RPC', ok: true }],
    used: new Set(),
    async activate(config) {
      if (h.failActivate) throw h.failActivate;
      h.activated.push(config);
    },
    async deactivate(ref) {
      h.deactivated.push(ref);
    },
    async inUse(ref) {
      return h.used.has(ref.id) ? `assets on ${ref.id}` : false;
    },
  };
  if (opts.withCheck !== false) {
    h.check = async (ref, values, secrets) => {
      h.checkCalls.push({ ref, values, secrets });
      return h.checksResult;
    };
  }
  return h;
};

export const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

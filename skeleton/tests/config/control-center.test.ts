import express from 'express';
import { randomUUID } from 'node:crypto';
import winston from 'winston';
import { ConfigurationStep, ControlCenterSchema, deriveControlCenter, registerConfigRoutes, statusDetails, statusFault, URL_PATTERN } from '../../src/config';
import { envelope, IDENTITY } from './support/control-center';
import { serve } from './support/http';
import { MemoryConfigurationService, SECRET } from './support/service';

const silent = winston.createLogger({ silent: true });
const NETWORK = { scope: 'network', targetKind: 'network', targetId: 'eip155:31337' };

/** ownera-apps AdapterConfig constants.ts: Control Center's relay drops a refusal field that does not match it. */
const FIELD_POINTER_PATTERN = /^(\/[A-Za-z0-9_-]{1,64}){1,5}$/;

describe('Control Center manifest, derived from the service', () => {
  const { manifest } = deriveControlCenter(new MemoryConfigurationService(), IDENTITY);

  it('names the adapter, its networks and one configure flow: the steps in order, then activate', () => {
    expect(manifest).toMatchObject({
      manifestVersion: 1,
      wizardId: 'test-adapter',
      adapter: { kind: 'custody', name: 'Test adapter', version: '1.0.0' },
      compatibility: { hostContract: 2 },
      targets: { network: [{ id: 'eip155:31337', label: 'Anvil' }] },
      flows: { configure: { title: 'Configure', scope: 'integration', operations: ['get-fields', 'save-custody', 'save-tuning', 'activate'] } },
      status: { operation: 'get-status' },
    });
    expect(Object.keys(manifest.operations)).toEqual(['save-custody', 'save-tuning', 'get-fields', 'activate', 'get-status']);
    expect(Object.values(manifest.operations).map((op) => op.idempotency)).toEqual(['none', 'none', 'none', 'none', 'none']);
    expect(Object.values(manifest.operations).map((op) => op.limits.timeoutMs)).toEqual([30000, 30000, 30000, 30000, 30000]);
  });

  it('turns inputs into a request schema: url as a pattern, a maxLength on every string, enum, integer, format', () => {
    const custody = manifest.operations['save-custody'];
    expect(custody.request).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', maxLength: 2048, pattern: URL_PATTERN, minLength: 1, title: 'Custody URL' },
        apiKey: { type: 'string', maxLength: 4096, title: 'API key' },
        custody_region: { type: 'string', maxLength: 4096, pattern: '^[a-z]{2}-[a-z]+$', title: 'Region' },
      },
    });
    expect(custody.secretFields).toEqual(['/apiKey']);
    for (const op of Object.values(manifest.operations)) {
      for (const key of Object.keys(op.request.properties ?? {})) expect(`/${key}`).toMatch(FIELD_POINTER_PATTERN);
    }
    expect(manifest.operations['save-tuning'].request.properties).toEqual({
      mode: { type: 'string', enum: ['fast', 'safe'], maxLength: 4, minLength: 1, title: 'Mode' },
      retries: { type: 'integer', title: 'Retries' },
      owner: { type: 'string', maxLength: 4096, title: 'Owner' },
    });
    expect(manifest.operations['save-tuning'].request.required).toEqual(['mode']);
    expect(custody.limits.maxBodyBytes).toBeLessThanOrEqual(64 * 1024);
  });

  it('keeps every schema within Control Center\'s compiler: depth 5 at most, maxItems 1 at least', () => {
    const faults: string[] = [];
    const walk = (schema: ControlCenterSchema, depth: number, at: string) => {
      if (depth > 5) faults.push(`${at} too deep`);
      if (schema.type === 'array' && !(Number.isInteger(schema.maxItems) && schema.maxItems! >= 1 && schema.maxItems! <= 200)) faults.push(`${at} maxItems`);
      if (schema.type === 'string' && !(Number.isInteger(schema.maxLength) && schema.maxLength! <= 4096)) faults.push(`${at} maxLength`);
      for (const [key, child] of Object.entries(schema.properties ?? {})) walk(child, depth + 1, `${at}/${key}`);
      if (schema.items) walk(schema.items, depth + 1, `${at}/items`);
    };
    for (const service of [new MemoryConfigurationService(), Object.assign(new MemoryConfigurationService(), { networks: () => [] })]) {
      for (const [id, op] of Object.entries(deriveControlCenter(service, IDENTITY).manifest.operations)) {
        walk(op.request, 1, `${id}.request`);
        walk(op.response, 1, `${id}.response`);
      }
    }
    expect(faults).toEqual([]);
  });

  it('declares get-fields: every step a property, set bounded to the step\'s wire ids', () => {
    expect(manifest.operations['get-fields'].request).toEqual({ type: 'object', additionalProperties: false, properties: {}, required: [] });
    expect(manifest.operations['get-fields'].response).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['steps'],
      properties: {
        steps: {
          type: 'object',
          additionalProperties: false,
          required: ['custody', 'tuning'],
          properties: {
            custody: { type: 'object', additionalProperties: false, required: ['set'], properties: { set: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 64, enum: ['url', 'apiKey', 'custody_region'] } } } },
            tuning: { type: 'object', additionalProperties: false, required: ['set'], properties: { set: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 64, enum: ['mode', 'retries', 'owner'] } } } },
          },
        },
      },
    });
  });

  it('derives no get-fields when the service has no inputsSet, and allows one more step', () => {
    const service = new MemoryConfigurationService();
    (service as { inputsSet?: unknown }).inputsSet = undefined;
    service.steps = () => Array.from({ length: 31 }, (_, i) => ({ id: `s${i}`, title: 'S', inputs: [] }));
    const { manifest: bare } = deriveControlCenter(service, IDENTITY);
    expect(bare.operations).not.toHaveProperty('get-fields');
    expect(bare.flows.configure.operations[0]).toBe('save-s0');
    expect(bare.flows.configure.operations).toHaveLength(32);
  });

  it('keeps the timeout the adapter declares', () => {
    const derived = deriveControlCenter(new MemoryConfigurationService(), { ...IDENTITY, timeoutMs: 20000 });
    expect(derived.manifest.operations.activate.limits.timeoutMs).toBe(20000);
  });
});

describe('Control Center derivation refuses what the manifest cannot carry', () => {
  const withSteps = (steps: ConfigurationStep[]) => {
    const service = new MemoryConfigurationService();
    service.steps = () => steps;
    return () => registerConfigRoutes(express(), service, { logger: silent, controlCenter: IDENTITY });
  };
  const input = { id: 'x', label: 'X', type: 'string' as const, classification: 'public' as const };

  it.each([
    ['a step id with upper case', [{ id: 'Custody', title: 'C', inputs: [] }], 'configuration step Custody'],
    ['a step id too long for save-<id>', [{ id: 'a'.repeat(60), title: 'C', inputs: [] }], 'configuration step a'],
    ['a step declared twice', [{ id: 'a', title: 'A', inputs: [] }, { id: 'a', title: 'A', inputs: [] }], 'declared twice'],
    ['an input id that is no pointer token', [{ id: 'a', title: 'A', inputs: [{ ...input, id: 'a/b' }] }], 'configuration input a/a/b'],
    ['an input declared twice', [{ id: 'a', title: 'A', inputs: [input, input] }], 'declared twice'],
    ['two inputs with one Control Center id', [{ id: 'a', title: 'A', inputs: [{ ...input, id: 'x.y' }, { ...input, id: 'x_y' }] }], 'Control Center id x_y is also a/x.y\'s'],
    ['a format that is no regular expression', [{ id: 'a', title: 'A', inputs: [{ ...input, format: { pattern: '(', message: 'm' } }] }], 'format.pattern'],
    ['an enum without options', [{ id: 'a', title: 'A', inputs: [{ ...input, type: 'enum' as const }] }], 'an enum needs options'],
    ['more inputs than Control Center takes', [{ id: 'a', title: 'A', inputs: Array.from({ length: 33 }, (_, i) => ({ ...input, id: `x${i}` })) }], 'more than 32 inputs'],
    ['more steps than the flow takes', Array.from({ length: 31 }, (_, i) => ({ id: `s${i}`, title: 'S', inputs: [] })), 'more than 30 steps'],
  ])('refuses %s', (_, steps, message) => {
    expect(withSteps(steps as ConfigurationStep[])).toThrow(message);
  });

  it.each([
    ['a timeout over Control Center\'s 30 s ceiling', { timeoutMs: 30001 }, 'limits.timeoutMs'],
    ['a timeout under its floor', { timeoutMs: 99 }, 'limits.timeoutMs'],
    ['a version Control Center would refuse', { adapter: { ...IDENTITY.adapter, version: 'v 1' } }, 'adapter.version'],
    ['a name longer than 128', { adapter: { ...IDENTITY.adapter, name: 'n'.repeat(129) } }, 'adapter.name'],
  ])('refuses %s', (_, identity, message) => {
    expect(() => registerConfigRoutes(express(), new MemoryConfigurationService(), { logger: silent, controlCenter: { ...IDENTITY, ...identity } }))
      .toThrow(message);
  });

  it.each([
    ['more than 50', Array.from({ length: 51 }, (_, i) => ({ id: `eip155:${i + 1}`, label: 'N' })), 'targets.network'],
    ['a label longer than 128', [{ id: 'eip155:1', label: 'l'.repeat(129) }], 'targets.network.label'],
    ['a duplicate', [{ id: 'eip155:1', label: 'A' }, { id: 'eip155:1', label: 'B' }], 'targets.network duplicate'],
  ])('refuses networks: %s', (_, networks, message) => {
    const service = new MemoryConfigurationService();
    service.networks = () => networks;
    expect(() => registerConfigRoutes(express(), service, { logger: silent, controlCenter: IDENTITY })).toThrow(message);
  });

  it('leaves a pattern Control Center would refuse to the adapter, keeps a safe one, and logs which', () => {
    const service = new MemoryConfigurationService();
    const pattern = (p: string) => ({ ...input, format: { pattern: p, message: 'm' } });
    service.steps = () => [{
      id: 'a',
      title: 'A',
      inputs: [
        { ...pattern('^\\s*(0x[0-9a-fA-F]{40}[\\s,]*)*$'), id: 'list' },
        { ...pattern('^(a+)+$'), id: 'nested' },
        { ...pattern('^(?=a)a$'), id: 'lookahead' },
        { ...pattern('a'.repeat(257)), id: 'long' },
        { ...pattern('^0x[0-9a-fA-F]{40}$'), id: 'address' },
        { ...pattern('^[a-z]{2}-[a-z]+$'), id: 'region' },
      ],
    }];
    const { manifest, patternsLeftToAdapter } = deriveControlCenter(service, IDENTITY);
    const properties = manifest.operations['save-a'].request.properties!;
    expect(patternsLeftToAdapter).toEqual(['a/list', 'a/nested', 'a/lookahead', 'a/long']);
    for (const id of ['list', 'nested', 'lookahead', 'long']) expect(properties[id]).not.toHaveProperty('pattern');
    expect(properties.address.pattern).toBe('^0x[0-9a-fA-F]{40}$');
    expect(properties.region.pattern).toBe('^[a-z]{2}-[a-z]+$');
    expect(manifest.operations['save-a'].request.properties!.list).toMatchObject({ type: 'string', maxLength: 4096 });

    const warnings: string[] = [];
    const logger = winston.createLogger({ transports: [new winston.transports.Console({ silent: true })] });
    logger.warn = ((message: string) => { warnings.push(message); return logger; }) as typeof logger.warn;
    registerConfigRoutes(express(), service, { logger, controlCenter: IDENTITY });
    expect(warnings).toEqual(['a/list', 'a/nested', 'a/lookahead', 'a/long'].map((id) => `configuration input ${id}: pattern left to the adapter`));
  });

  it('keeps its own url pattern, which Control Center takes', () => {
    const { patternsLeftToAdapter } = deriveControlCenter(new MemoryConfigurationService(), IDENTITY);
    expect(patternsLeftToAdapter).toEqual([]);
  });

  it('accepts no networks at all', () => {
    const service = new MemoryConfigurationService();
    service.networks = () => [];
    expect(deriveControlCenter(service, IDENTITY).manifest.targets.network).toEqual([]);
  });

  it('refuses an identity Control Center would refuse, and an undeclarable network', () => {
    const service = new MemoryConfigurationService();
    expect(() => registerConfigRoutes(express(), service, { logger: silent, controlCenter: { ...IDENTITY, wizardId: 'Test' } }))
      .toThrow('the Control Center manifest is not valid: wizardId');
    service.networks = () => [{ id: 'not a network', label: 'x' }];
    expect(() => registerConfigRoutes(express(), service, { logger: silent, controlCenter: IDENTITY })).toThrow('targets.network');
  });
});

describe('Control Center routes', () => {
  let service: MemoryConfigurationService;
  let s: Awaited<ReturnType<typeof serve>>;

  const post = (op: string, body: Buffer | string, headers: Record<string, string> = {}) =>
    s.request('POST', `/config/operations/${op}`, body, { 'content-type': 'application/json; charset=utf-8', ...headers });
  const step = (op: string, input: Record<string, unknown> = {}, opts: { context?: object; headers?: Record<string, string> } = {}) =>
    post(op, envelope(input, opts.context), opts.headers);

  beforeEach(async () => {
    service = new MemoryConfigurationService();
    const app = express();
    registerConfigRoutes(app, service, { logger: silent, controlCenter: IDENTITY });
    s = await serve(app);
  });

  afterEach(() => s.close());

  it('serves the derived manifest as JSON', async () => {
    const res = await s.request('GET', '/config/manifest');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/^application\/json/);
    expect(res.body).toEqual(deriveControlCenter(new MemoryConfigurationService(), IDENTITY).manifest);
  });

  it('saves a step and answers its check: missing, then valid, then invalid scrubbed', async () => {
    expect(await step('save-custody', { url: 'https://custody.example' })).toMatchObject({
      status: 200, body: { output: { valid: false, message: 'Missing: custody.apiKey' } },
    });
    expect(await step('save-custody', { url: 'https://custody.example', apiKey: SECRET })).toMatchObject({
      status: 200, body: { output: { valid: true, message: 'Connected.' } },
    });
    // the secret left out keeps the stored one
    const bad = await step('save-custody', { url: 'https://bad.example' });
    expect(bad.body).toEqual({ output: { valid: false, message: 'refused with key ••••' } });
    expect(bad.text).not.toContain(SECRET);
    expect(service.saves.map((c) => c.input)).toEqual([
      { url: 'https://custody.example' }, { url: 'https://custody.example', apiKey: SECRET }, { url: 'https://bad.example' },
    ]);
  });

  it('answers get-fields with the wire ids of stored inputs per step, never a value', async () => {
    expect((await step('get-fields')).body).toEqual({ output: { steps: { custody: { set: [] }, tuning: { set: [] } } } });
    await step('save-custody', { url: 'https://custody.example', apiKey: SECRET, custody_region: 'eu-west' });
    await step('save-tuning', { mode: 'safe', retries: 3 });
    const res = await step('get-fields');
    expect(res).toMatchObject({ status: 200 });
    // in the step's order, each once, unknown ids and steps dropped, dotted ids on the wire
    expect(res.body).toEqual({ output: { steps: { custody: { set: ['url', 'apiKey', 'custody_region'] }, tuning: { set: ['mode', 'retries'] } } } });
    for (const value of [SECRET, 'custody.example', 'eu-west', 'safe']) expect(res.text).not.toContain(value);
  });

  it('answers Saved. for a step with no checks, and hands an integer over as its decimal string', async () => {
    expect(await step('save-tuning', { mode: 'safe', retries: 3 })).toMatchObject({ status: 200, body: { output: { valid: true, message: 'Saved.' } } });
    expect(service.saves[0]).toEqual({ stepId: 'tuning', input: { mode: 'safe', retries: '3' } });
    expect(service.values['tuning.retries']).toBe('3');
  });

  it('refuses input outside the derived schema with its pointer, before the service sees it', async () => {
    expect(await step('save-custody', { url: 'ftp://x' })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT', field: '/url' } } });
    expect(await step('save-custody', { apiKey: SECRET })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT', field: '/url' } } });
    expect(await step('save-custody', { url: '' })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT', field: '/url' } } });
    expect(await step('save-custody', { url: 'https://c', custody_region: 'EU' })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT', field: '/custody_region' } } });
    // the adapter's dotted id is not a Control Center id
    expect(await step('save-custody', { url: 'https://c', 'custody.region': 'eu-west' })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT' } } });
    expect(await step('save-tuning', { mode: 'other' })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT', field: '/mode' } } });
    expect(await step('save-tuning', { mode: 'fast', retries: 1.5 })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT', field: '/retries' } } });
    expect(await step('save-tuning', { mode: 'fast', extra: 'x' })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT', field: '/extra' } } });
    expect(service.saves).toHaveLength(0);
  });

  it('answers a refused save as 422 INVALID_CONFIG, with the input pointer when the service names one', async () => {
    const withInput = await step('save-custody', { url: 'https://refused.example' });
    expect(withInput).toMatchObject({ status: 422, body: { error: { code: 'INVALID_CONFIG', field: '/url' } } });
    expect(withInput.text).not.toContain('refused.example');
    const dotted = await step('save-custody', { url: 'https://c', custody_region: 'zz-refused' });
    expect(dotted).toMatchObject({ status: 422, body: { error: { code: 'INVALID_CONFIG', field: '/custody_region' } } });
    expect(dotted.body.error.field).toMatch(FIELD_POINTER_PATTERN);
    expect(service.saves[1]).toEqual({ stepId: 'custody', input: { url: 'https://c', 'custody.region': 'zz-refused' } });
    const derived = await step('save-custody', { url: 'https://c', custody_region: 'zz-derived' });
    expect(derived.body).toEqual({ error: { code: 'INVALID_CONFIG' } });
  });

  it('activates: the applied version, 409 CONFIG_INCOMPLETE, 422 APPLY_FAILED retryable', async () => {
    service.problems = [{ kind: 'missing', ref: 'custody.url', message: 'Required.' }];
    expect(await step('activate')).toMatchObject({ status: 409, body: { error: { code: 'CONFIG_INCOMPLETE' } } });
    service.problems = [{ kind: 'activation', ref: 'adapter', message: `login refused for ${SECRET}` }];
    const failed = await step('activate');
    expect(failed).toMatchObject({ status: 422, body: { error: { code: 'APPLY_FAILED', retryable: true } } });
    expect(failed.text).not.toContain(SECRET);
    service.problems = [];
    expect(await step('activate')).toEqual(expect.objectContaining({ status: 200, body: { output: { version: 1, appliedAt: '2026-11-25T00:00:00Z' } } }));
  });

  const DECLARED = new Set(['eip155:31337']);

  it('answers the status in Control Center\'s envelope: the integration and each declared network', async () => {
    const first = (await step('get-status')).body.output;
    expect(first).toEqual({
      integration: { state: 'not_configured', details: [{ id: 'url', label: 'Custody', value: 'not set' }] },
      networks: [{ id: 'eip155:31337', state: 'not_configured' }],
    });
    expect(statusFault(first, DECLARED)).toBeUndefined();
    await step('activate');
    const active = (await step('get-status')).body.output;
    expect(active.integration.state).toBe('active');
    expect(active.networks).toEqual([{ id: 'eip155:31337', state: 'active' }]);
  });

  it('puts a scrubbed problem line first when the adapter has failed', async () => {
    await step('save-custody', { url: 'https://c', apiKey: SECRET });
    service.state = 'failed';
    service.error = `login refused for ${SECRET}`;
    const output = (await step('get-status')).body.output;
    expect(output.integration).toEqual({
      state: 'needs_attention',
      details: [{ id: 'problem', label: 'Problem', value: 'login refused for ••••' }, { id: 'url', label: 'Custody', value: 'not set' }],
    });
    expect(statusFault(output, DECLARED)).toBeUndefined();
  });

  it('answers networks: [] when none are declared', async () => {
    const bare = new MemoryConfigurationService();
    bare.networks = () => [];
    const app = express();
    registerConfigRoutes(app, bare, { logger: silent, controlCenter: IDENTITY });
    const other = await serve(app);
    try {
      const output = (await other.request('POST', '/config/operations/get-status', envelope({}), { 'content-type': 'application/json' })).body.output;
      expect(output.networks).toEqual([]);
      expect(statusFault(output, new Set())).toBeUndefined();
    } finally { await other.close(); }
  });

  it('fits any summary into the envelope instead of failing the status', async () => {
    service.summaryItems = [
      { id: 'Ledger RPC', label: 'L'.repeat(100), value: 'v'.repeat(600) },
      { id: 'ledger-rpc', label: 'duplicate once slugged', value: 'x' },
      { id: '***', label: 'no usable id', value: 'x' },
      { id: 'emoji', label: '', value: `${'a'.repeat(126)}😀😀` },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, label: 'F', value: 'v' })),
    ];
    service.state = 'failed';
    service.error = 'e'.repeat(300);
    const res = await step('get-status');
    expect(res.status).toBe(200);
    const { output } = res.body;
    expect(statusFault(output, DECLARED)).toBeUndefined();
    const { details } = output.integration;
    expect(details).toHaveLength(8);
    expect(details.map((d: { id: string }) => d.id)).toEqual(['problem', 'ledger-rpc', 'emoji', 'f0', 'f1', 'f2', 'f3', 'f4']);
    expect(details[0].value).toHaveLength(128);
    expect(details[1].label).toHaveLength(64);
    expect(details[2].label).toBe('emoji');
    expect(details[2].value.length).toBeLessThanOrEqual(128);
    expect(details[2].value.endsWith('…')).toBe(true);
  });

  it('keeps every derived status detail within Control Center\'s rules', () => {
    const odd = statusDetails([{ id: 'A_B', label: 'x'.repeat(70), value: '' }, { id: '-lead', label: 'y', value: 'z' }], undefined, []);
    expect(odd).toEqual([{ id: 'a-b', label: `${'x'.repeat(63)}…`, value: '' }, { id: 'lead', label: 'y', value: 'z' }]);
    expect(statusFault({ integration: { state: 'active', details: odd }, networks: [] }, new Set())).toBeUndefined();
  });

  it('ignores an Idempotency-Key: a repeated key runs again, an invalid one is not refused', async () => {
    const key = randomUUID();
    expect((await step('save-tuning', { mode: 'fast' }, { headers: { 'idempotency-key': key } })).status).toBe(200);
    expect((await step('save-tuning', { mode: 'safe' }, { headers: { 'idempotency-key': key } })).status).toBe(200);
    expect((await step('save-tuning', { mode: 'safe' }, { headers: { 'idempotency-key': 'not-a-uuid' } })).status).toBe(200);
    expect(service.saves.map((c) => c.input.mode)).toEqual(['fast', 'safe', 'safe']);
  });

  it.each([
    ['a network context for an integration operation', 'save-tuning', NETWORK],
    ['a network context for the status', 'get-status', NETWORK],
    ['an extra key', 'save-tuning', { scope: 'integration', org: 'bank-us' }],
  ])('refuses %s', async (_, op, context) => {
    expect(await step(op, { mode: 'fast' }, { context })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_CONTEXT' } } });
    expect(service.saves).toHaveLength(0);
  });

  it('refuses a body that is not exactly { context, input } in UTF-8 without a BOM', async () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), envelope({})]);
    for (const body of ['{', '[]', JSON.stringify({ input: {} }), JSON.stringify({ context: { scope: 'integration' }, input: {}, extra: 1 }), bom, Buffer.from([0xff, 0xfe])]) {
      expect((await post('get-status', body)).body).toEqual({ error: { code: 'INVALID_REQUEST' } });
    }
  });

  it('answers 500 INTERNAL_ERROR when the service throws, without its message', async () => {
    service.saveStep = async () => { throw new Error(`database down, key ${SECRET}`); };
    const res = await step('save-tuning', { mode: 'fast' });
    expect(res).toMatchObject({ status: 500, body: { error: { code: 'INTERNAL_ERROR' } } });
    expect(res.text).not.toContain(SECRET);
  });

  it('logs the requested id of an unknown operation, masked and bounded', async () => {
    const lines: string[] = [];
    const logger = winston.createLogger({ transports: [new winston.transports.Console({ silent: true })] });
    logger.info = ((message: string) => { lines.push(message); return logger; }) as typeof logger.info;
    const app = express();
    registerConfigRoutes(app, new MemoryConfigurationService(), { logger, controlCenter: IDENTITY });
    const other = await serve(app);
    try {
      await other.request('POST', '/config/operations/save-nope', envelope({}), { 'content-type': 'application/json' });
      await other.request('POST', `/config/operations/${encodeURIComponent('bad id\n')}${'x'.repeat(100)}`, envelope({}), { 'content-type': 'application/json' });
    } finally { await other.close(); }
    expect(lines[0]).toBe('control center POST save-nope 404 NOT_FOUND');
    expect(lines[1]).toBe(`control center POST bad?id?${'x'.repeat(57)} 404 NOT_FOUND`);
  });

  it('refuses an unknown operation, another content type and a body over the limit', async () => {
    expect(await post('save-nope', envelope({}))).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } });
    expect(await post('save-tuning', envelope({ mode: 'fast' }), { 'content-type': 'text/plain' })).toMatchObject({ status: 415, body: { error: { code: 'UNSUPPORTED_MEDIA_TYPE' } } });
    expect(await step('activate', { pad: 'x'.repeat(2000) })).toMatchObject({ status: 413, body: { error: { code: 'REQUEST_TOO_LARGE' } } });
    expect(await step('save-custody', { url: `https://${'x'.repeat(70 * 1024)}` })).toMatchObject({ status: 413, body: { error: { code: 'REQUEST_TOO_LARGE' } } });
    expect(service.saves).toHaveLength(0);
  });

  it('keeps the field API on its JSON parser next to the raw operations', async () => {
    expect((await s.request('PUT', '/config/values', { values: { 'custody.url': 'https://c' } })).status).toBe(200);
    expect((await step('get-status')).status).toBe(200);
  });
});

describe('without Control Center', () => {
  it('serves no manifest route', async () => {
    const app = express();
    registerConfigRoutes(app, new MemoryConfigurationService(), { logger: silent });
    const s = await serve(app);
    try {
      expect((await s.request('GET', '/config/manifest')).status).toBe(404);
      expect((await s.request('GET', '/config/status')).status).toBe(200);
    } finally { await s.close(); }
  });
});


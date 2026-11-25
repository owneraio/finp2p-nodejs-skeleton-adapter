import express from 'express';
import winston from 'winston';
import { MISCONFIGURED_BODY_PARSER, registerConfigRoutes } from '../../src/config';
import { envelope, MANIFEST } from './support/control-center';
import { serve } from './support/http';
import { MemoryConfigurationService, SECRET } from './support/service';

const silent = winston.createLogger({ silent: true });

describe('configuration API', () => {
  let service: MemoryConfigurationService;
  let s: Awaited<ReturnType<typeof serve>>;

  beforeEach(async () => {
    service = new MemoryConfigurationService();
    const app = express();
    registerConfigRoutes(app, service, { logger: silent });
    s = await serve(app);
  });

  afterEach(() => s.close());

  const put = (values: unknown) => s.request('PUT', '/config/values', values === undefined ? undefined : { values });

  it('answers the status with applied as null before the first apply, and the version after', async () => {
    expect(await s.request('GET', '/config/status')).toMatchObject({ status: 200, body: { state: 'unconfigured', applied: null } });
    await s.request('POST', '/config/apply');
    expect((await s.request('GET', '/config/status')).body).toEqual({ state: 'active', applied: { version: 1, appliedAt: '2026-11-25T00:00:00Z' } });
  });

  it('serves the schema and the values as the service answers them', async () => {
    expect((await s.request('GET', '/config/schema')).body).toEqual(service.schema());
    expect((await s.request('GET', '/config/values')).body).toEqual({ values: {} });
  });

  it('stores values all or nothing and answers the view, secrets masked by the service', async () => {
    expect(await put({ 'custody.url': 'https://custody', 'custody.apiKey': SECRET })).toEqual(expect.objectContaining({
      status: 200, body: { values: { 'custody.url': 'https://custody', 'custody.apiKey': { sealed: true } } },
    }));
    expect(await put({ 'custody.url': 'https://other', 'nope.x': '1' })).toMatchObject({
      status: 422, body: { error: 'Some values were rejected; nothing was saved.', fields: { 'nope.x': 'No such field.' } },
    });
    expect(service.values['custody.url']).toBe('https://custody');
    expect((await put({ 'custody.url': null })).body).toEqual({ values: { 'custody.apiKey': { sealed: true } } });
  });

  it('scrubs a sealed value out of a refusal reason', async () => {
    await put({ 'custody.apiKey': SECRET });
    const res = await put({ 'custody.url': SECRET });
    expect(res.status).toBe(422);
    expect(res.body.fields['custody.url']).toBe('Not a URL: ••••');
    expect(res.text).not.toContain(SECRET);
  });

  it.each([
    ['no values', undefined],
    ['values as an array', ['a']],
    ['values as a string', 'a'],
  ])('refuses a PUT with %s', async (_, values) => {
    const res = values === undefined ? await s.request('PUT', '/config/values', {}) : await put(values);
    expect(res).toMatchObject({ status: 400, body: { error: 'Expected { "values": { "<fieldId>": "<value>" | null } }.' } });
  });

  it('answers 400 as JSON for a body that is not JSON', async () => {
    const res = await s.request('PUT', '/config/values', '{');
    expect(res).toMatchObject({ status: 400, body: { error: 'The body is not valid JSON.' } });
  });

  it('runs a check and answers its record, scrubbed, with the fields the service added', async () => {
    await put({ 'custody.url': 'https://custody', 'custody.apiKey': SECRET });
    const res = await s.request('POST', '/config/validate', { field: 'custody.url' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'invalid', message: 'refused with key ••••', details: [{ label: 'key', value: '••••' }], checkedAt: '2026-11-25T00:00:00Z' });
    expect(res.text).not.toContain(SECRET);
  });

  it('answers a check that cannot run: 404 unknown, 409 inactive, 409 with what is missing', async () => {
    expect(await s.request('POST', '/config/validate', { group: 'nope' })).toMatchObject({ status: 404, body: { error: 'No check is defined for group nope.' } });
    expect(await s.request('POST', '/config/validate', { group: 'legacy' })).toMatchObject({ status: 409, body: { error: 'legacy does not apply to the current configuration.' } });
    expect(await s.request('POST', '/config/validate', { field: 'custody.url' })).toMatchObject({
      status: 409, body: { error: 'Fill in the required fields before this check can run.', missing: ['custody.url'] },
    });
  });

  it.each([
    ['neither field nor group', {}],
    ['both', { field: 'custody.url', group: 'custody' }],
    ['a field that is not a string', { field: 7 }],
  ])('refuses a validate with %s', async (_, body) => {
    expect(await s.request('POST', '/config/validate', body)).toMatchObject({
      status: 400, body: { error: 'Expected { "field": "<fieldId>" } or { "group": "<groupId>" }.' },
    });
  });

  it('applies, or answers 409 when incomplete and 422 when the adapter did not start, problems scrubbed', async () => {
    expect(await s.request('POST', '/config/apply')).toMatchObject({ status: 200, body: { version: 1, appliedAt: '2026-11-25T00:00:00Z' } });

    service.problems = [{ kind: 'missing', ref: 'custody.url', message: 'Required.' }];
    expect(await s.request('POST', '/config/apply')).toMatchObject({
      status: 409, body: { error: 'The configuration is not complete.', problems: service.problems },
    });

    await put({ 'custody.apiKey': SECRET });
    service.problems = [{ kind: 'check', ref: 'custody', message: 'stale' }, { kind: 'activation', ref: 'adapter', message: `login refused for ${SECRET}` }];
    const failed = await s.request('POST', '/config/apply');
    expect(failed.status).toBe(422);
    expect(failed.body.error).toBe('The adapter did not start on this configuration; the previous one stays applied.');
    expect(failed.body.problems[1]).toEqual({ kind: 'activation', ref: 'adapter', message: 'login refused for ••••' });
    expect(failed.text).not.toContain(SECRET);
  });

  it('answers 500 without the message when the service throws', async () => {
    service.check = async () => { throw new Error(`database down, key ${SECRET}`); };
    const res = await s.request('POST', '/config/validate', { field: 'custody.url' });
    expect(res).toMatchObject({ status: 500, body: { error: 'internal error' } });
    expect(res.text).not.toContain(SECRET);
  });
});

describe('configuration API behind an app-wide body parser', () => {
  it('answers 500 misconfigured for a request whose body was already parsed', async () => {
    const app = express();
    app.use(express.json());
    const service = new MemoryConfigurationService();
    registerConfigRoutes(app, service, {
      logger: silent,
      controlCenter: { manifest: MANIFEST, operations: Object.fromEntries(Object.keys(MANIFEST.operations).map((op) => [op, async () => ({ state: 'active' })])) },
    });
    const s = await serve(app);
    try {
      expect(await s.request('PUT', '/config/values', { values: { 'custody.url': 'https://c' } })).toMatchObject({ status: 500, body: { error: MISCONFIGURED_BODY_PARSER } });
      expect(service.values).toEqual({});
      expect(await s.request('POST', '/config/operations/get-status', envelope({}))).toMatchObject({ status: 500, body: { error: MISCONFIGURED_BODY_PARSER } });
      // a request without a body was never parsed, so it is served
      expect((await s.request('GET', '/config/status')).status).toBe(200);
    } finally { await s.close(); }
  });
});

// The adapter's configuration API, all under /config:
//   GET  /status      the adapter's status, with the applied version or null
//   GET  /schema      what to render: groups, fields, checks
//   GET  /values      the stored values, secrets masked, and what blocks an apply
//   PUT  /values      { values: { <fieldId>: <value> | null } }, all or nothing
//   POST /validate    { field: <fieldId> } or { group: <checkRef> }: runs that check
//   POST /apply       applies the stored values; the previous version stays on failure
//   POST /actions/:ref { input: { <inputId>: <value> } }: runs a configuration action
// and, with opts.controlCenter, host contract 2 (control-center/), its manifest derived
// from the service (control-center/derive.ts):
//   GET  /manifest, POST /operations/:operationId
//
// The skeleton owns these routes and knows no field: the adapter's ConfigurationService
// does the work. Every message answered is scrubbed of the service's sealed values.
//
// SECURITY: unauthenticated, like the account-mapping and whitelist routes. They write
// secrets and restart the adapter on new values, so serve them on a port only the
// operator's backend can reach (Control Center's backend, behind a NetworkPolicy), never
// on the router-facing API port.
import express from 'express';
import winston from 'winston';
import { logger as defaultLogger } from '../helpers/logger';
import { ControlCenterIdentity, deriveControlCenter } from './control-center/derive';
import { mountControlCenterRoutes } from './control-center/routes';
import { scrub } from './scrub';
import { ConfigurationService } from './service';

export interface ConfigRoutesOptions {
  /** Defaults to the skeleton logger. Bodies, headers and values are never logged. */
  logger?: winston.Logger;
  /** Body limit of PUT /values and POST /validate. Default 1mb. */
  jsonLimit?: string;
  /**
   * Serve Control Center's host contract 2. The manifest and its operations are derived
   * from the service's steps, networks, summary, status and apply; this names the adapter.
   * A description the manifest cannot carry throws here, so the adapter does not start.
   */
  controlCenter?: ControlCenterIdentity;
}

export const MISCONFIGURED_BODY_PARSER =
  'Misconfigured: a body parser ran before the configuration routes. Call registerConfigRoutes before any app-wide body parser.';

/**
 * Mounts the configuration API at /config on `app`. Call it before any app-wide body
 * parser: the Control Center operations read the raw body, so a request whose body was
 * already parsed is answered 500 rather than guessed at.
 */
export function registerConfigRoutes(app: express.Application, service: ConfigurationService, opts: ConfigRoutesOptions = {}): void {
  const log = (opts.logger ?? defaultLogger) as winston.Logger;
  const json = express.json({ limit: opts.jsonLimit ?? '1mb' });
  const router = express.Router();

  router.use((req, res, next) => {
    if (req.body !== undefined) {
      log.error('configuration route reached with a parsed body: a body parser runs before registerConfigRoutes');
      res.status(500).json({ error: MISCONFIGURED_BODY_PARSER });
      return;
    }
    next();
  });

  if (opts.controlCenter) {
    const { manifest, operations } = deriveControlCenter(service, opts.controlCenter);
    mountControlCenterRoutes(router, manifest, operations, log);
  }

  router.get('/status', async (_req, res) => {
    const status = await service.status();
    res.json({ ...status, applied: status.applied ?? null });
  });

  router.get('/schema', async (_req, res) => {
    res.json(await service.schema());
  });

  router.get('/values', async (_req, res) => {
    res.json(await service.view());
  });

  router.put('/values', json, async (req, res) => {
    const updates = req.body?.values;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      res.status(400).json({ error: 'Expected { "values": { "<fieldId>": "<value>" | null } }.' });
      return;
    }
    const refused = await service.write(updates);
    if (Object.keys(refused).length) {
      const secrets = await service.sealedValues();
      const fields = Object.fromEntries(Object.entries(refused).map(([id, reason]) => [id, scrub(reason, secrets)]));
      res.status(422).json({ error: 'Some values were rejected; nothing was saved.', fields });
      return;
    }
    log.info('configuration values updated', { fields: Object.keys(updates) });
    res.json(await service.view());
  });

  router.post('/validate', json, async (req, res) => {
    const { field, group } = req.body ?? {};
    const refId: unknown = field ?? group;
    if (typeof refId !== 'string' || (field !== undefined && group !== undefined)) {
      res.status(400).json({ error: 'Expected { "field": "<fieldId>" } or { "group": "<groupId>" }.' });
      return;
    }
    const scope = field !== undefined ? 'field' : 'group';
    const run = await service.check(refId, scope);
    if (run.kind === 'unknown') {
      res.status(404).json({ error: `No check is defined for ${scope} ${refId}.` });
      return;
    }
    if (run.kind === 'inactive') {
      res.status(409).json({ error: `${refId} does not apply to the current configuration.` });
      return;
    }
    if (run.kind === 'missing') {
      res.status(409).json({ error: 'Fill in the required fields before this check can run.', missing: run.missing });
      return;
    }
    const secrets = await service.sealedValues();
    const { record } = run;
    log.info('configuration check', { ref: refId, scope, status: record.status });
    res.json({
      ...record,
      message: scrub(record.message, secrets),
      ...(record.details ? { details: record.details.map((d) => ({ label: d.label, value: scrub(d.value, secrets) })) } : {}),
    });
  });

  router.post('/apply', async (_req, res) => {
    const outcome = await service.apply();
    if (!outcome.ok) {
      const secrets = await service.sealedValues();
      const problems = outcome.problems.map((p) => ({ ...p, message: scrub(p.message, secrets) }));
      const failed = problems.some((p) => p.kind === 'activation');
      log.warn(failed ? 'configuration apply failed to start the adapter' : 'configuration apply refused', { problems: problems.map((p) => `${p.kind} ${p.ref}`) });
      res.status(failed ? 422 : 409).json({
        error: failed ? 'The adapter did not start on this configuration; the previous one stays applied.' : 'The configuration is not complete.',
        problems,
      });
      return;
    }
    log.info('configuration applied', { version: outcome.applied.version });
    res.json(outcome.applied);
  });

  router.post('/actions/:ref', json, async (req, res) => {
    if (!service.runAction) {
      res.status(404).json({ error: 'This adapter offers no configuration actions.' });
      return;
    }
    const input: unknown = req.body?.input ?? {};
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      res.status(400).json({ error: 'Expected { "input": { "<inputId>": "<value>" } }.' });
      return;
    }
    const ref = String(req.params.ref);
    const outcome = await service.runAction(ref, input as Record<string, unknown>);
    const secrets = await service.sealedValues();
    // the ref comes from the request: log a bounded copy, never the input
    log.info('configuration action', { ref: ref.slice(0, 64), status: outcome.status });
    res.status(outcome.status === 'done' ? 200 : 422).json({
      ...outcome,
      message: scrub(outcome.message, secrets),
      ...(outcome.details ? { details: outcome.details.map((d) => ({ label: d.label, value: scrub(d.value, secrets) })) } : {}),
    });
  });

  // the JSON parser's errors and anything the service throws; registered last so it covers every route above
  router.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(err); return; }
    const type = (err as { type?: string } | undefined)?.type;
    if (type === 'entity.parse.failed') { res.status(400).json({ error: 'The body is not valid JSON.' }); return; }
    if (type === 'entity.too.large') { res.status(413).json({ error: 'The body is too large.' }); return; }
    // the message may carry a secret: log the kind only, answer without it
    log.error('configuration route failed', { method: req.method, path: req.path, error: err instanceof Error ? err.name : typeof err });
    res.status(500).json({ error: 'internal error' });
  });

  app.use('/config', router);
}

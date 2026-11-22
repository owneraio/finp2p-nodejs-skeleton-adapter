// HTTP surface of the config contract (adapter-config/2):
//   GET    /config                  descriptor
//   POST   /config/validate         dry run              { kind?, id?, values }
//   POST   /config/apply            merge + validate + store + activate   { kind?, id, name?, default?, values }
//   DELETE /config/:kind/:id        remove a config (409 when the handler says it is in use)
// For kind 'network' the id is the ledger (CAIP-2), e.g. DELETE /config/network/eip155:11155111.
// For kind 'account' the id is CAIP-10, e.g. DELETE /config/account/eip155:1:0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb.
// Bodies are never logged; unexpected errors answer 500 without the message.
import express from 'express';
import expressWinston from 'express-winston';
import winston from 'winston';
import { logger as defaultLogger } from '../helpers/logger';
import { ConfigRequestError, ConfigRuntime } from './runtime';
import { ConfigKind, ERROR_CODES, RequestValues } from './types';

export interface ConfigRoutesOptions {
  jsonLimit?: string;
  /** Request log target. Defaults to the skeleton logger. */
  logger?: winston.Logger;
}

const actorOf = (req: express.Request): string | undefined => {
  const h = req.headers['x-actor'];
  return Array.isArray(h) ? h[0] : h;
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Body must be { values: { ... } }. Answers 400 and returns undefined otherwise. */
const valuesOf = (req: express.Request, res: express.Response): RequestValues | undefined => {
  const body: unknown = req.body;
  const values = isObject(body) ? body.values : undefined;
  if (!isObject(values)) {
    res.status(400).json({ error: 'body must be { values: { ... } }' });
    return undefined;
  }
  return values as RequestValues;
};

const optionalString = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function registerConfigRoutes(
  app: express.Application,
  runtime: ConfigRuntime,
  opts: ConfigRoutesOptions = {},
): void {
  app.use('/config', express.json({ limit: opts.jsonLimit ?? '1mb' }));
  app.use('/config', expressWinston.logger({
    winstonInstance: (opts.logger ?? defaultLogger) as winston.Logger,
    meta: false,   // never log bodies or headers
    msg: 'HTTP {{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms',
  }));

  app.get('/config', async (req, res, next) => {
    try {
      res.json(await runtime.describe());
    } catch (e) {
      next(e);
    }
  });

  app.post('/config/validate', async (req, res, next) => {
    try {
      const values = valuesOf(req, res);
      if (!values) return;
      const { body } = req;
      res.json(await runtime.validate({
        kind: optionalString(body.kind) as ConfigKind | undefined,
        id: optionalString(body.id),
        values,
      }));
    } catch (e) {
      next(e);
    }
  });

  app.post('/config/apply', async (req, res, next) => {
    try {
      const values = valuesOf(req, res);
      if (!values) return;
      const { body } = req;
      const result = await runtime.apply({
        kind: optionalString(body.kind) as ConfigKind | undefined,
        id: body.id,
        name: optionalString(body.name),
        default: typeof body.default === 'boolean' ? body.default : undefined,
        values,
      }, actorOf(req));
      // 200 ok, 422 validation / check failure, 500 activation failed
      const buildFailed = result.errors.some((e) => e.code === ERROR_CODES.buildFailed);
      res.status(result.ok ? 200 : buildFailed ? 500 : 422).json(result);
    } catch (e) {
      next(e);
    }
  });

  app.delete('/config/:kind/:id', async (req, res, next) => {
    try {
      await runtime.remove(ConfigRuntime.refOf(req.params.kind, req.params.id));
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // scoped error handler: registered last so it covers the JSON parser and every route above
  app.use('/config', (err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(err); return; }
    if (err instanceof ConfigRequestError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    const type = (err as { type?: string })?.type;
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid JSON' });
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json({ error: 'body too large' });
      return;
    }
    // the message may carry a secret: log the kind only, answer without it
    const name = err instanceof Error ? err.name : typeof err;
    (opts.logger ?? defaultLogger).error('config route failed', { method: req.method, path: req.path, error: name });
    res.status(500).json({ error: 'internal error' });
  });
}

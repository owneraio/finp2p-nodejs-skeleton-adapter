// HTTP surface of the adapter config (adapter-config/3):
//   GET  /config   the config version, the state and the configured values (secrets as { set: true })
//   POST /config   merge a document into the stored one; apply it when a value changed
// Bodies are never logged; unexpected errors answer 500 without the message.
import express from 'express';
import expressWinston from 'express-winston';
import winston from 'winston';
import { logger as defaultLogger } from '../helpers/logger';
import { ConfigRequestError, ConfigRuntime } from './runtime';
import { ERROR_CODES } from './types';

export interface ConfigRoutesOptions {
  jsonLimit?: string;
  /** Request log target. Defaults to the skeleton logger. */
  logger?: winston.Logger;
}

const actorOf = (req: express.Request): string | undefined => {
  const h = req.headers['x-actor'];
  return Array.isArray(h) ? h[0] : h;
};

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

  app.post('/config', async (req, res, next) => {
    try {
      const result = await runtime.apply(req.body, actorOf(req));
      // 200 applied or unchanged, 422 invalid values, 500 the adapter could not apply or store it
      const failed = result.errors.some((e) => e.code === ERROR_CODES.applyFailed);
      res.status(result.ok ? 200 : failed ? 500 : 422).json(result);
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
      res.status(400).json({ error: 'invalid JSON', code: ERROR_CODES.badRequest });
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

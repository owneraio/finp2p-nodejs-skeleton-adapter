// HTTP surface of the wizard contract: GET /config/manifest and
// POST /config/operations/:operationId, nothing else. Never logs a header or a body:
// only the method, a known operation, the status and a bounded code.
import express from 'express';
import winston from 'winston';
import { logger as defaultLogger } from '../../helpers/logger';
import { verifyGrant, ReplayGuard } from './grant';
import { IdempotencyCache } from './idempotency';
import { has, JsonObject } from './jws';
import { schemaFault } from './schema';
import { CODE_PATTERN, Wizard, WizardOperation, WizardRefusal } from './types';

const HARD_BODY_CAP = 64 * 1024;
const JSON_CONTENT_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;
const FIELD_POINTER = /^(\/[A-Za-z0-9_-]{1,64}){1,5}$/;

export interface WizardRoutesOptions {
  logger?: winston.Logger;
}

interface Reply { status: number; body: JsonObject }

/** Every copy of a header, from the raw list: a repeated Authorization or Idempotency-Key is refused. */
const distinct = (req: express.Request, name: string): string[] | undefined => {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === name) values.push(req.rawHeaders[i + 1]);
  }
  return values.length ? values : undefined;
};

const refusal = (status: number, code: string, extra: { field?: string; retryable?: boolean } = {}): Reply => ({
  status,
  body: {
    error: {
      code,
      ...(extra.field && FIELD_POINTER.test(extra.field) ? { field: extra.field } : {}),
      ...(extra.retryable ? { retryable: true } : {}),
    },
  },
});

export function registerWizardRoutes(
  app: express.Application,
  wizard: Wizard,
  operations: Record<string, WizardOperation>,
  opts: WizardRoutesOptions = {},
): void {
  const { manifest, pins } = wizard;
  const missing = Object.keys(manifest.operations).filter((op) => !operations[op]);
  if (missing.length) throw new Error(`no handler for wizard operation(s): ${missing.join(', ')}`);
  const log = opts.logger ?? defaultLogger;
  const replay = new ReplayGuard();
  const idempotency = new IdempotencyCache<Reply>({ keep: (r) => r.status === 200 });
  const manifestBytes = Buffer.from(wizard.manifestJws, 'utf8');

  const send = (res: express.Response, op: string, { status, body }: Reply, detail?: string) => {
    const bytes = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
    res.end(bytes);
    const code = (body.error as { code?: string } | undefined)?.code;
    log.info(`wizard POST ${op} ${status}${detail ?? (code ? ` ${code}` : '')}`);
  };

  // the adapter checks its own answer against the manifest it published
  const run = async (op: string, call: Parameters<WizardOperation>[0]): Promise<Reply> => {
    const spec = manifest.operations[op];
    try {
      const output = await operations[op](call);
      const size = Buffer.byteLength(JSON.stringify({ output }), 'utf8');
      if (schemaFault(spec.response, output) !== null || size > spec.limits.maxResponseBytes) {
        log.error(`wizard operation ${op} answered outside its response schema`);
        return refusal(500, 'RESPONSE_INVALID');
      }
      return { status: 200, body: { output } };
    } catch (e) {
      if (e instanceof WizardRefusal && CODE_PATTERN.test(e.code)) return refusal(e.status, e.code, e);
      log.error(`wizard operation ${op} failed`);
      return refusal(500, 'INTERNAL_ERROR');
    }
  };

  app.get('/config/manifest', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': manifestBytes.length, 'Cache-Control': 'no-store' });
    res.end(manifestBytes);
  });

  app.post('/config/operations/:operationId', express.raw({ type: () => true, limit: HARD_BODY_CAP }), async (req, res) => {
    const requested = String(req.params.operationId);
    if (!has(manifest.operations, requested)) { send(res, '-', refusal(404, 'NOT_FOUND')); return; }
    const op = requested;
    const spec = manifest.operations[op];
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (rawBody.length > Math.min(spec.limits.maxBodyBytes, HARD_BODY_CAP)) { send(res, op, refusal(413, 'REQUEST_TOO_LARGE')); return; }
    const contentTypes = distinct(req, 'content-type') ?? [];
    if (contentTypes.length !== 1 || !JSON_CONTENT_TYPE.test(contentTypes[0])) { send(res, op, refusal(415, 'UNSUPPORTED_MEDIA_TYPE')); return; }

    const grant = verifyGrant({
      authorization: distinct(req, 'authorization'),
      operationId: op,
      rawBody,
      idempotencyKey: distinct(req, 'idempotency-key'),
      pins,
      manifest,
      replay,
    });
    if (!grant.ok) {
      send(res, op, { status: 401, body: { error: { code: 'GRANT_INVALID', reason: grant.reason } } }, ` GRANT_INVALID ${grant.reason}`);
      return;
    }
    const { claims, envelope } = grant;
    const field = schemaFault(spec.request, envelope.input);
    if (field !== null) { send(res, op, refusal(400, 'INVALID_INPUT', { field })); return; }

    const call = { operationId: op, flow: claims.flow, scope: claims.scope, targetId: claims.targetId, subject: claims.sub, input: envelope.input };
    if (!has(claims, 'idem')) { send(res, op, await run(op, call)); return; }
    const keyParts = [claims.integration, claims.flow, op, claims.scope, claims.targetId ?? null, claims.idem as string];
    const outcome = await idempotency.run(keyParts, claims.req, () => run(op, call));
    send(res, op, outcome.conflict ? refusal(409, 'IDEMPOTENCY_KEY_REUSED') : outcome.result);
  });

  // the raw parser's own errors (too large, aborted) in the contract's shape
  app.use('/config/operations', (err: { status?: number; type?: string }, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(err); return; }
    send(res, '-', err?.type === 'entity.too.large' ? refusal(413, 'REQUEST_TOO_LARGE') : refusal(400, 'BAD_REQUEST'));
  });
}

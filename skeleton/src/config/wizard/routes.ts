// HTTP surface of the wizard contract: GET /config/manifest and
// POST /config/operations/:operationId, nothing else. Never logs a header or a body:
// only the method, a known operation, the status and a bounded code.
import express from 'express';
import winston from 'winston';
import { logger as defaultLogger } from '../../helpers/logger';
import { IdempotencyCache } from './idempotency';
import { has, hasOnlyKeys, isPlainObject, JsonObject, parseJsonObject, sha256Hex } from './json';
import { checkManifest, contextOf } from './manifest';
import { schemaFault } from './schema';
import { CODE_PATTERN, IDEMPOTENCY_KEY_PATTERN, WizardOperation, WizardRefusal } from './types';

const HARD_BODY_CAP = 64 * 1024;
const JSON_CONTENT_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;
const FIELD_POINTER = /^(\/[A-Za-z0-9_-]{1,64}){1,5}$/;

export interface WizardRoutesOptions {
  logger?: winston.Logger;
}

interface Reply { status: number; body: JsonObject }

/** Every copy of a header, from the raw list: a repeated Content-Type or Idempotency-Key is refused. */
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

/** `manifest` is checked here (checkManifest): an adapter with a bad manifest does not start. */
export function registerWizardRoutes(
  app: express.Application,
  manifestSource: unknown,
  operations: Record<string, WizardOperation>,
  opts: WizardRoutesOptions = {},
): void {
  const manifest = checkManifest(manifestSource);
  const missing = Object.keys(manifest.operations).filter((op) => !operations[op]);
  if (missing.length) throw new Error(`no handler for wizard operation(s): ${missing.join(', ')}`);
  const log = opts.logger ?? defaultLogger;
  const idempotency = new IdempotencyCache<Reply>({ keep: (r) => r.status === 200 });
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');

  const send = (res: express.Response, op: string, { status, body }: Reply) => {
    const bytes = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
    res.end(bytes);
    const code = (body.error as { code?: string } | undefined)?.code;
    log.info(`wizard POST ${op} ${status}${code ? ` ${code}` : ''}`);
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
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': manifestBytes.length, 'Cache-Control': 'no-store' });
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

    const envelope = parseJsonObject(rawBody);
    if (!envelope || !hasOnlyKeys(envelope, ['context', 'input']) || !isPlainObject(envelope.context) || !isPlainObject(envelope.input)) {
      send(res, op, refusal(400, 'INVALID_REQUEST'));
      return;
    }
    const context = contextOf(manifest, op, envelope.context);
    if (!context) { send(res, op, refusal(400, 'INVALID_CONTEXT')); return; }
    const keys = distinct(req, 'idempotency-key');
    if (keys && (keys.length !== 1 || !IDEMPOTENCY_KEY_PATTERN.test(keys[0]))) { send(res, op, refusal(400, 'INVALID_IDEMPOTENCY_KEY')); return; }
    const idem = keys?.[0];
    if (!idem && spec.idempotency === 'required') { send(res, op, refusal(400, 'IDEMPOTENCY_KEY_REQUIRED')); return; }
    const field = schemaFault(spec.request, envelope.input);
    if (field !== null) { send(res, op, refusal(400, 'INVALID_INPUT', { field })); return; }

    const targetId = context.scope === 'network' ? context.targetId : undefined;
    const call = { operationId: op, scope: context.scope, targetId, input: envelope.input };
    if (!idem) { send(res, op, await run(op, call)); return; }
    // a refusal is not kept: the user fixes the input and retries with the same key
    const outcome = await idempotency.run([op, context.scope, targetId ?? null, idem], sha256Hex(rawBody), () => run(op, call));
    send(res, op, outcome.conflict ? refusal(409, 'IDEMPOTENCY_KEY_REUSED') : outcome.result);
  });

  // the raw parser's own errors (too large, aborted) in the contract's shape
  app.use('/config/operations', (err: { status?: number; type?: string }, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(err); return; }
    send(res, '-', err?.type === 'entity.too.large' ? refusal(413, 'REQUEST_TOO_LARGE') : refusal(400, 'BAD_REQUEST'));
  });
}

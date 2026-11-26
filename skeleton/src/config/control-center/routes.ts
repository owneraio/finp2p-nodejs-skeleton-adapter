// The Control Center routes, mounted by registerConfigRoutes: GET /manifest and
// POST /operations/:operationId under /config. Never logs a header or a body: only the
// method, a known operation, the status and a bounded code.
import express from 'express';
import winston from 'winston';
import { has, hasOnlyKeys, isPlainObject, JsonObject, parseJsonObject } from './json';
import { checkManifest, contextOf } from './manifest';
import { schemaFault } from './schema';
import { CODE_PATTERN, ControlCenterCall, ControlCenterOperationHandler, ControlCenterRefusal } from './types';

const HARD_BODY_CAP = 64 * 1024;
const JSON_CONTENT_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;
/** Control Center's FIELD_POINTER_PATTERN (ownera-apps AdapterConfig constants.ts): its relay drops any other field. */
const FIELD_POINTER = /^(\/[A-Za-z0-9_-]{1,64}){1,5}$/;

interface Reply { status: number; body: JsonObject }

/** Every copy of a header, from the raw list: a repeated Content-Type is refused. */
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

const isRefusal = (e: unknown): e is ControlCenterRefusal =>
  typeof (e as Partial<ControlCenterRefusal> | undefined)?.code === 'string' && CODE_PATTERN.test((e as ControlCenterRefusal).code);

const refusalStatus = (status: unknown): number =>
  (Number.isInteger(status) && (status as number) >= 400 && (status as number) <= 599 ? status as number : 422);

/**
 * Mounts the Control Center routes on `router` (which registerConfigRoutes mounts at /config).
 * `manifestSource` is checked here: an adapter with a bad manifest, or a manifest operation
 * with no handler, does not start.
 */
export function mountControlCenterRoutes(
  router: express.Router,
  manifestSource: unknown,
  operations: Record<string, ControlCenterOperationHandler>,
  log: winston.Logger,
): void {
  const manifest = checkManifest(manifestSource);
  const missing = Object.keys(manifest.operations).filter((op) => typeof operations[op] !== 'function');
  if (missing.length) throw new Error(`no handler for Control Center operation(s): ${missing.join(', ')}`);
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');

  const send = (res: express.Response, op: string, { status, body }: Reply) => {
    const bytes = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
    res.end(bytes);
    const code = (body.error as { code?: string } | undefined)?.code;
    log.info(`control center POST ${op} ${status}${code ? ` ${code}` : ''}`);
  };

  // the adapter checks its own answer against the manifest it published
  const run = async (op: string, call: ControlCenterCall): Promise<Reply> => {
    const spec = manifest.operations[op];
    try {
      const output = await operations[op](call);
      const size = Buffer.byteLength(JSON.stringify({ output }), 'utf8');
      if (schemaFault(spec.response, output) !== null || size > spec.limits.maxResponseBytes) {
        log.error(`control center operation ${op} answered outside its response schema`);
        return refusal(500, 'RESPONSE_INVALID');
      }
      return { status: 200, body: { output } };
    } catch (e) {
      if (isRefusal(e)) return refusal(refusalStatus(e.status), e.code, { field: e.field, retryable: e.retryable });
      log.error(`control center operation ${op} failed`);
      return refusal(500, 'INTERNAL_ERROR');
    }
  };

  router.get('/manifest', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': manifestBytes.length, 'Cache-Control': 'no-store' });
    res.end(manifestBytes);
  });

  router.post('/operations/:operationId', express.raw({ type: () => true, limit: HARD_BODY_CAP }), async (req, res) => {
    const requested = String(req.params.operationId);
    // the id comes from the request: log a bounded copy with anything outside an id's characters masked
    if (!has(manifest.operations, requested)) { send(res, requested.slice(0, 64).replace(/[^A-Za-z0-9._-]/g, '?'), refusal(404, 'NOT_FOUND')); return; }
    const op = requested;
    const spec = manifest.operations[op];
    // a copy, so nothing below reads a property off the request's own value (capped at HARD_BODY_CAP by the parser)
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? Buffer.from(req.body) : Buffer.alloc(0);
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
    const field = schemaFault(spec.request, envelope.input);
    if (field !== null) { send(res, op, refusal(400, 'INVALID_INPUT', { field })); return; }
    // an Idempotency-Key header, if Control Center sent one, is ignored: there is no idempotency here
    const targetId = context.scope === 'network' ? context.targetId : undefined;
    send(res, op, await run(op, { scope: context.scope, ...(targetId ? { targetId } : {}), input: envelope.input }));
  });

  // the raw parser's own errors (too large, aborted) in the contract's shape
  router.use('/operations', (err: { type?: string }, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(err); return; }
    send(res, '-', err?.type === 'entity.too.large' ? refusal(413, 'REQUEST_TOO_LARGE') : refusal(400, 'BAD_REQUEST'));
  });
}

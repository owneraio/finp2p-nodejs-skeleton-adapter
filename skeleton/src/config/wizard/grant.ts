// Config grant verification. Every check fails closed with one reason from GRANT_REASONS;
// nothing about the token, the body or the claims leaves this module.
import { b64urlDecodeStrict, has, isPlainObject, JsonObject, parseCompact, parseJsonObject, sha256Hex, verifyEs256 } from './jws';
import { GRANT_TYP, STATUS_FLOW, WizardManifest, WizardPins, WizardScope } from './types';

export const GRANT_LIFETIME_SECONDS = 60;
export const CLOCK_SKEW_SECONDS = 30;
export const MAX_GRANT_BYTES = 4096;
export const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const GRANT_REASONS = [
  'malformed', 'algorithm', 'key', 'signature', 'issuer', 'audience', 'org', 'env', 'expired',
  'not_yet_valid', 'lifetime', 'operation', 'flow', 'scope', 'target', 'body', 'idempotency', 'replay',
] as const;
export type GrantReason = typeof GRANT_REASONS[number];

export interface GrantClaims {
  iss: string; aud: string; sub: string; org: string; env: string;
  integration: string; wizard: string; flow: string; scope: WizardScope; op: string;
  manifest: string; req: string; jti: string;
  targetKind?: string; targetId?: string; idem?: string;
  iat: number; exp: number;
}

export interface WireEnvelope { context: JsonObject; input: JsonObject }

export type GrantCheck =
  | { ok: true; claims: GrantClaims; envelope: WireEnvelope }
  | { ok: false; reason: GrantReason };

const BEARER = /^Bearer ([^\s]+)$/;
const SUB = /^user:\d+$/;
const HEADER_KEYS = ['alg', 'kid', 'typ'];
const STRING_CLAIMS = ['iss', 'aud', 'sub', 'org', 'env', 'integration', 'wizard', 'flow', 'scope', 'op'];
const DIGEST_CLAIMS = ['manifest', 'req', 'jti'];
const OPTIONAL_STRING_CLAIMS = ['targetKind', 'targetId', 'idem'];
const KNOWN_CLAIMS = new Set([...STRING_CLAIMS, ...DIGEST_CLAIMS, ...OPTIONAL_STRING_CLAIMS, 'iat', 'exp']);

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

type Header = string | string[] | undefined;
// A repeated header arrives as an array (headersDistinct) and is refused as null.
const singleHeader = (value: Header): string | null | undefined =>
  Array.isArray(value) ? (value.length > 1 ? null : value[0]) : value;

/** Remembers consumed grant ids until exp + skew, the last moment the same token could pass the time checks. */
export class ReplayGuard {
  private consumed = new Map<string, number>();

  consume(jti: string, exp: number, now: number): boolean {
    for (const [id, until] of this.consumed) {
      if (until <= now) this.consumed.delete(id);
    }
    if (this.consumed.has(jti)) return false;
    this.consumed.set(jti, exp + CLOCK_SKEW_SECONDS);
    return true;
  }
}

export interface GrantRequest {
  authorization: Header;
  /** The operation named in the URL. */
  operationId: string;
  /** The exact request bytes. */
  rawBody: Uint8Array;
  idempotencyKey: Header;
  pins: WizardPins;
  manifest: WizardManifest;
  replay: ReplayGuard;
  /** Seconds since the epoch. */
  now?: number;
}

export function verifyGrant(r: GrantRequest): GrantCheck {
  const at = r.now ?? nowSeconds();
  const fail = (reason: GrantReason): GrantCheck => ({ ok: false, reason });

  const bearer = singleHeader(r.authorization);
  const token = typeof bearer === 'string' ? BEARER.exec(bearer)?.[1] : undefined;
  if (!token || Buffer.byteLength(token, 'utf8') > MAX_GRANT_BYTES) return fail('malformed');
  const parts = parseCompact(token);
  if (!parts) return fail('malformed');
  const raw = parseJsonObject(parts.payloadBytes);
  if (!raw || Object.keys(parts.header).some((key) => !HEADER_KEYS.includes(key))) return fail('malformed');

  const { alg, typ, kid } = parts.header;
  if (alg !== 'ES256') return fail('algorithm');
  if (typ !== GRANT_TYP) return fail('malformed');
  if (kid !== r.pins.grantKid) return fail('key');
  if (!verifyEs256(parts.signingInput, parts.signature, r.pins.grantPublicKey)) return fail('signature');
  if (!claimsWellFormed(raw)) return fail('malformed');
  const claims = raw as unknown as GrantClaims;

  // integration, wizard and manifest narrow the audience to this exact adapter
  if (claims.iss !== r.pins.issuer) return fail('issuer');
  if (claims.aud !== r.pins.audience || claims.integration !== r.pins.integrationId
    || claims.wizard !== r.pins.wizardId || claims.manifest !== r.pins.manifestDigest) return fail('audience');
  if (claims.org !== r.pins.org) return fail('org');
  if (claims.env !== r.pins.env) return fail('env');

  if (claims.iat > at + CLOCK_SKEW_SECONDS) return fail('not_yet_valid');
  if (claims.exp <= at - CLOCK_SKEW_SECONDS) return fail('expired');
  if (claims.exp - claims.iat !== GRANT_LIFETIME_SECONDS) return fail('lifetime');

  // what it allows, read from the adapter's own manifest
  if (claims.op !== r.operationId) return fail('operation');
  const flowScope = scopeOfFlow(r.manifest, claims.flow, claims.op);
  if (!flowScope) return fail('flow');
  if (claims.scope !== flowScope) return fail('scope');
  if (!targetAllowed(r.manifest, claims)) return fail('target');

  // the body it was minted for
  const envelope = parseJsonObject(r.rawBody);
  if (!isEnvelope(envelope)) return fail('body');
  const contextReason = contextMismatch(envelope.context, claims);
  if (contextReason) return fail(contextReason);
  if (sha256Hex(r.rawBody) !== claims.req) return fail('body');

  if (!idempotencyMatches(r.manifest.operations[claims.op].idempotency, claims, r.idempotencyKey)) return fail('idempotency');

  // consumed before anything runs, so a racing duplicate cannot slip through
  if (!r.replay.consume(claims.jti, claims.exp, at)) return fail('replay');
  return { ok: true, claims, envelope };
}

function claimsWellFormed(claims: JsonObject): boolean {
  if (Object.keys(claims).some((key) => !KNOWN_CLAIMS.has(key))) return false;
  if ([...STRING_CLAIMS, ...DIGEST_CLAIMS].some((key) => typeof claims[key] !== 'string')) return false;
  if (OPTIONAL_STRING_CLAIMS.some((key) => has(claims, key) && typeof claims[key] !== 'string')) return false;
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || (claims.iat as number) <= 0) return false;
  if (!SUB.test(claims.sub as string)) return false;
  // at least 128 random bits, canonical base64url
  const jti = b64urlDecodeStrict(claims.jti);
  return jti !== null && jti.length >= 16 && jti.length <= 64;
}

function scopeOfFlow(manifest: WizardManifest, flowId: string, op: string): WizardScope | null {
  if (flowId === STATUS_FLOW) return op === manifest.status.operation ? 'integration' : null;
  if (!has(manifest.flows, flowId)) return null;
  const flow = manifest.flows[flowId];
  return flow.operations.includes(op) ? flow.scope : null;
}

function targetAllowed(manifest: WizardManifest, claims: GrantClaims): boolean {
  if (claims.scope !== 'network') return !has(claims, 'targetKind') && !has(claims, 'targetId');
  return claims.targetKind === 'network' && manifest.targets.network.some((t) => t.id === claims.targetId);
}

function isEnvelope(body: JsonObject | null): body is JsonObject & WireEnvelope {
  if (!body) return false;
  const keys = Object.keys(body);
  return keys.length === 2 && isPlainObject(body.context) && isPlainObject(body.input);
}

function contextMismatch(context: JsonObject, claims: GrantClaims): GrantReason | null {
  if (context.scope !== claims.scope) return 'scope';
  if (claims.scope === 'network') {
    if (context.targetKind !== claims.targetKind || context.targetId !== claims.targetId) return 'target';
    return Object.keys(context).length === 3 ? null : 'body';
  }
  return Object.keys(context).length === 1 ? null : 'body';
}

function idempotencyMatches(policy: 'none' | 'required', claims: GrantClaims, headerValue: Header): boolean {
  const header = singleHeader(headerValue);
  if (header === null) return false;
  const hasClaim = has(claims, 'idem');
  const hasHeader = header !== undefined;
  if (policy === 'required' && !(hasClaim && hasHeader)) return false;
  if (hasClaim !== hasHeader) return false;
  return !hasClaim || (IDEMPOTENCY_KEY.test(header as string) && header === claims.idem);
}

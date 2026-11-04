import { isError } from 'ethers';

export type SendErrorKind = 'nonce-conflict' | 'underpriced' | 'already-known' | 'fatal';

const NONCE_CONFLICT_PATTERNS = [
  'nonce too low',
  'nonce has already been used',
  'invalid nonce',
];

const UNDERPRICED_PATTERNS = [
  'replacement transaction underpriced',
  'transaction underpriced',
  'fee too low',
];

const ALREADY_KNOWN_PATTERNS = [
  'already known',
  'already imported',
  'duplicate transaction',
];

function messagesOf(e: unknown): string {
  const parts: string[] = [];
  const err = e as { message?: string; info?: { error?: { message?: string } }; error?: { message?: string } };
  if (typeof err?.message === 'string') parts.push(err.message);
  if (typeof err?.info?.error?.message === 'string') parts.push(err.info.error.message);
  if (typeof err?.error?.message === 'string') parts.push(err.error.message);
  return parts.join(' | ').toLowerCase();
}

/**
 * Classifies a broadcast error. Ethers maps some node errors to typed codes
 * (NONCE_EXPIRED, REPLACEMENT_UNDERPRICED) but many RPCs surface them as
 * UNKNOWN_ERROR with the node message buried in error.info — hence the
 * message-sniffing fallback.
 */
export function classifySendError(e: unknown): SendErrorKind {
  if (isError(e, 'NONCE_EXPIRED')) return 'nonce-conflict';
  if (isError(e, 'REPLACEMENT_UNDERPRICED')) return 'underpriced';

  const msg = messagesOf(e);
  if (NONCE_CONFLICT_PATTERNS.some((p) => msg.includes(p))) return 'nonce-conflict';
  if (ALREADY_KNOWN_PATTERNS.some((p) => msg.includes(p))) return 'already-known';
  if (UNDERPRICED_PATTERNS.some((p) => msg.includes(p))) return 'underpriced';
  return 'fatal';
}

/** Compact, single-line rendering of an error for last_error columns and logs. */
export function describeError(e: unknown): string {
  const err = e as { code?: string; shortMessage?: string; message?: string };
  const code = typeof err?.code === 'string' ? `[${err.code}] ` : '';
  const msg = err?.shortMessage ?? err?.message ?? String(e);
  return `${code}${msg}`.slice(0, 1000);
}

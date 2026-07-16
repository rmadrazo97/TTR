/**
 * Inbound parse-webhook seam (PRD 01 §6): normalize any provider payload into an
 * {@link InboundEmail}, and verify the provider signature.
 *
 * IMPORTANT — the signature scheme here is a *stand-in*. Real Mailgun and Postmark use
 * their own header sets + canonicalization (Mailgun: `HMAC(key, timestamp+token)`;
 * Postmark: a Basic-Auth webhook + IP allowlist). We keep verification behind ONE
 * function so swapping in a provider's real scheme is a localized change, not a rewrite.
 * The POC therefore supports two normalized-but-synthetic HMAC schemes (both hex,
 * SHA-256, keyed by `INBOUND_WEBHOOK_SECRET`), selected by payload shape:
 *
 *  1. Task contract (camelCase): requires `timestamp` + signs
 *     `${timestamp}.${recipient}.${messageId}.${sha256(attachmentBytes)}...`.
 *     Timestamp must be within ±5 minutes of now to prevent replay.
 *  2. Repo fixture (snake_case): `signature === HMAC(secret, `${timestamp}.${body}`)`,
 *     where `body` is the compact JSON of the payload with `timestamp` + `signature`
 *     removed. This is the scheme documented in `src/fixtures/README.md`, so the
 *     committed `fixtures/receipt.webhook.json` verifies unchanged. Timestamp must
 *     also be within ±5 minutes unless the env var
 *     `WEBHOOK_SKIP_TIMESTAMP_CHECK=true` is set (allows frozen fixtures in tests
 *     that do not control the system clock).
 *
 * SECURITY NOTES:
 *  - Scheme 1 now covers sender + attachments in the signed data to prevent body-swap.
 *  - Both schemes reject timestamps older than TIMESTAMP_TOLERANCE_S seconds (replay guard).
 *  - The scheme is selected by payload shape (presence of `timestamp`); both require it.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { InboundEmail } from './types.js';

/** Thrown when the payload is structurally invalid (missing required fields). */
export class InvalidPayloadError extends Error {}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function verdict(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Coerce a raw provider payload into the internal {@link InboundEmail}. Accepts both the
 * task's camelCase contract (`sender`/`recipient`/`messageId`/`contentType`/`contentBase64`)
 * and the repo fixture's snake_case shape (`from`/`to`/`message_id`/`content_type`/
 * `content_base64`). Throws {@link InvalidPayloadError} if required fields are missing.
 */
export function normalizeInbound(raw: unknown): InboundEmail {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidPayloadError('payload must be a JSON object');
  }
  const p = raw as Record<string, unknown>;

  const sender = str(p['sender']) ?? str(p['from']);
  const recipient = str(p['recipient']) ?? str(p['to']);
  const messageId = str(p['messageId']) ?? str(p['message_id']);
  const subject = str(p['subject']) ?? '';
  const provider = str(p['provider']) ?? str(p['mail_provider']) ?? 'unknown';

  if (!recipient) throw new InvalidPayloadError('missing recipient (to)');
  if (!messageId) throw new InvalidPayloadError('missing messageId (message_id)');

  // Normalize the provider-supplied receipt timestamp (PRD 01 FR6). Fall back to now()
  // when the provider does not supply one, so the R2 key partition is always defined.
  const rawReceivedAt = str(p['received_at']) ?? str(p['receivedAt']);
  const receivedAt = rawReceivedAt ? new Date(rawReceivedAt) : new Date();

  const rawAttachments = Array.isArray(p['attachments']) ? (p['attachments'] as unknown[]) : [];
  const attachments = rawAttachments.map((a, i) => {
    const at = (typeof a === 'object' && a !== null ? a : {}) as Record<string, unknown>;
    const filename = str(at['filename']) ?? `attachment-${i}`;
    const contentType = str(at['contentType']) ?? str(at['content_type']) ?? 'application/octet-stream';
    const contentBase64 = str(at['contentBase64']) ?? str(at['content_base64']) ?? '';
    return { filename, contentType, contentBase64 };
  });

  return {
    provider,
    sender: sender ?? '',
    recipient,
    subject,
    messageId,
    receivedAt,
    auth: {
      spf: verdict(p['spf']),
      dkim: verdict(p['dkim']),
      dmarc: verdict(p['dmarc']),
    },
    attachments,
  };
}

/** How far in the past (seconds) a timestamp may be before we reject it as a replay. */
export const TIMESTAMP_TOLERANCE_S = 5 * 60; // 5 minutes

function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Constant-time hex-string comparison (never leak timing on the signature check). */
function safeEqualHex(a: string, b: string): boolean {
  // timingSafeEqual throws on length mismatch; guard first (length is not secret).
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Return false if `timestampStr` represents a Unix-seconds timestamp that is more than
 * `TIMESTAMP_TOLERANCE_S` seconds away from `nowMs`. Pass `skipCheck=true` in tests
 * that use frozen fixture timestamps.
 */
function isTimestampFresh(timestampStr: string, nowMs: number, skipCheck: boolean): boolean {
  if (skipCheck) return true;
  const ts = Number(timestampStr);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs / 1000 - ts) <= TIMESTAMP_TOLERANCE_S;
}

/**
 * Verify a provider webhook signature against the shared secret, constant-time.
 *
 * Both schemes require a `timestamp` field (Unix seconds as a string). Scheme is
 * selected by payload shape:
 *
 *  - camelCase (`recipient`/`messageId`): scheme-1 — signs
 *    `${timestamp}.${recipient}.${messageId}.${sender}.${attachmentHashes}`.
 *  - snake_case (`to`/`message_id`): scheme-2 — signs `${timestamp}.${compactBody}`.
 *
 * Returns true only on an exact constant-time match and a fresh timestamp.
 * Any structural problem returns false (caller responds 401).
 *
 * Set `opts.skipTimestampCheck = true` in unit tests with frozen fixture timestamps.
 */
export function verifySignature(
  raw: unknown,
  secret: string,
  opts: { skipTimestampCheck?: boolean; nowMs?: number } = {},
): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const p = raw as Record<string, unknown>;
  const signature = str(p['signature']);
  if (!signature) return false;

  const timestamp = p['timestamp'];
  if (timestamp === undefined || timestamp === null || timestamp === '') return false;
  const timestampStr = String(timestamp);
  const nowMs = opts.nowMs ?? Date.now();
  // The env-var replay bypass is honored ONLY outside production (frozen fixtures in
  // dev/test). An explicit opts.skipTimestampCheck (unit tests) still works everywhere.
  const envAllowsSkip =
    process.env.NODE_ENV !== 'production' &&
    process.env['WEBHOOK_SKIP_TIMESTAMP_CHECK'] === 'true';
  const skipTimestampCheck = opts.skipTimestampCheck ?? envAllowsSkip;

  // Scheme 2 — repo fixture / snake_case (Mailgun-style: timestamp + signed compact body).
  if (p['to'] !== undefined || p['message_id'] !== undefined) {
    if (!isTimestampFresh(timestampStr, nowMs, skipTimestampCheck)) return false;
    const { timestamp: _ts, signature: _sig, ...body } = p;
    const signed = `${timestampStr}.${JSON.stringify(body)}`;
    return safeEqualHex(hmacHex(secret, signed), signature);
  }

  // Scheme 1 — task contract / camelCase: timestamp + recipient + messageId + sender +
  // per-attachment content hashes. This covers the whole semantically relevant body so
  // an attacker who intercepts a valid signature cannot swap attachments or sender.
  const recipient = str(p['recipient']);
  const messageId = str(p['messageId']);
  if (!recipient || !messageId) return false;
  if (!isTimestampFresh(timestampStr, nowMs, skipTimestampCheck)) return false;

  const sender = str(p['sender']) ?? '';
  const rawAttachments = Array.isArray(p['attachments']) ? (p['attachments'] as unknown[]) : [];
  const attachmentHashes = rawAttachments
    .map((a) => {
      const at = (typeof a === 'object' && a !== null ? a : {}) as Record<string, unknown>;
      const b64 = str(at['contentBase64']) ?? '';
      return sha256Hex(Buffer.from(b64, 'base64'));
    })
    .join(',');

  const signed = `${timestampStr}.${recipient}.${messageId}.${sender}.${attachmentHashes}`;
  return safeEqualHex(hmacHex(secret, signed), signature);
}

/**
 * Produce a valid task-contract (camelCase / scheme-1) signature.
 *
 * Signs `${timestamp}.${recipient}.${messageId}.${sender}.${attachmentHashes}`.
 * All parameters must exactly match the payload that will be verified.
 * Used by fixtures and unit tests.
 */
export function signTaskContract(
  recipient: string,
  messageId: string,
  secret: string,
  opts: {
    timestamp?: string;
    sender?: string;
    attachments?: Array<{ contentBase64: string }>;
  } = {},
): string {
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const sender = opts.sender ?? '';
  const attachmentHashes = (opts.attachments ?? [])
    .map((a) => sha256Hex(Buffer.from(a.contentBase64, 'base64')))
    .join(',');
  const data = `${timestamp}.${recipient}.${messageId}.${sender}.${attachmentHashes}`;
  return hmacHex(secret, data);
}

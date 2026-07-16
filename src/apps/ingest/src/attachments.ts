/**
 * Attachment validation + storage-key derivation (PRD 01 FR4/FR5).
 *
 * - MIME allowlist: image/jpeg, image/png, application/pdf. Everything else is rejected
 *   with a Spanish nudge (FR4/FR11). Multi-page fuel-card PDFs are first-class.
 * - 25 MiB whole-message limit. base64 inflates ~33%, so we measure the *decoded* bytes
 *   and also cap the *total* decoded size across all attachments in one email.
 * - Key layout: `receipts/{driver_id}/{yyyy}/{mm}/{message_id}-{attachment_index}.{ext}`
 *   (PRD 01 FR5 / 03). `message_id` is sanitized (angle brackets / path chars stripped)
 *   so it is safe as an object-key segment while staying deterministic for dedup.
 */
import type { InboundAttachment } from './types.js';

/** Provider MIME → allowed + canonical file extension. jpg/png/pdf only. */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg', // some clients mislabel; treat as jpeg
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/** 25 MiB whole-message limit (PRD 01 FR4). */
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

export type AttachmentRejectReason = 'bad_mime' | 'empty' | 'oversize';

export interface DecodedAttachment {
  index: number;
  filename: string;
  contentType: string;
  ext: string;
  bytes: Buffer;
  size: number;
}

export interface AttachmentValidation {
  /** Attachments that passed validation, ready to store + record. */
  accepted: DecodedAttachment[];
  /** Attachments rejected, with a machine reason (drives the Spanish nudge). */
  rejected: Array<{ index: number; filename: string; reason: AttachmentRejectReason }>;
}

/** Look up the canonical extension for an allowed MIME, or null if not allowed. */
export function extForMime(mime: string): string | null {
  return ALLOWED_MIME[mime.toLowerCase().trim()] ?? null;
}

/**
 * Decode + validate every attachment on one email. Rejects non-allowlisted MIME, empty
 * bodies, and any individual attachment over the 25 MiB limit; additionally rejects the
 * whole batch as oversize once the *cumulative* decoded size crosses the limit (base64
 * inflation is already gone because we measure decoded bytes).
 */
export function validateAttachments(attachments: InboundAttachment[]): AttachmentValidation {
  const accepted: DecodedAttachment[] = [];
  const rejected: AttachmentValidation['rejected'] = [];
  let cumulative = 0;

  attachments.forEach((a, index) => {
    const ext = extForMime(a.contentType);
    if (!ext) {
      rejected.push({ index, filename: a.filename, reason: 'bad_mime' });
      return;
    }
    const bytes = Buffer.from(a.contentBase64 ?? '', 'base64');
    if (bytes.length === 0) {
      rejected.push({ index, filename: a.filename, reason: 'empty' });
      return;
    }
    if (bytes.length > MAX_MESSAGE_BYTES || cumulative + bytes.length > MAX_MESSAGE_BYTES) {
      rejected.push({ index, filename: a.filename, reason: 'oversize' });
      return;
    }
    cumulative += bytes.length;
    accepted.push({
      index,
      filename: a.filename,
      contentType: a.contentType,
      ext,
      bytes,
      size: bytes.length,
    });
  });

  return { accepted, rejected };
}

/** Strip characters that are unsafe or ugly in an object-key segment, keep it deterministic. */
function sanitizeSegment(s: string): string {
  return s.replace(/[<>]/g, '').replace(/[^A-Za-z0-9._@-]/g, '_');
}

/**
 * Build the R2/S3 object key for one attachment (PRD 01 FR5):
 * `receipts/{driver_id}/{yyyy}/{mm}/{message_id}-{attachment_index}.{ext}`.
 * `receivedAt` sets the yyyy/mm partition (defaults to now).
 */
export function buildObjectKey(
  driverId: string,
  messageId: string,
  attachmentIndex: number,
  ext: string,
  receivedAt: Date = new Date(),
): string {
  const yyyy = String(receivedAt.getUTCFullYear());
  const mm = String(receivedAt.getUTCMonth() + 1).padStart(2, '0');
  const mid = sanitizeSegment(messageId);
  return `receipts/${driverId}/${yyyy}/${mm}/${mid}-${attachmentIndex}.${ext}`;
}

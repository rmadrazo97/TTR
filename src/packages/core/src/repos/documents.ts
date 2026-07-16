/**
 * `document` repo (PRD 01/03). One attachment = one Document; dedup on
 * (message_id, attachment_index). Includes the worker's claim-next primitive
 * (FOR UPDATE SKIP LOCKED) and the console's review-queue reads (with the joined
 * extraction, ordered by lowest overall confidence first).
 */
import { query } from '../db.js';
import type { Document, DocumentSource, DocumentStatus, Extraction } from '../types.js';

export interface DocumentInput {
  driver_id?: string | null;
  r2_key: string;
  from_addr?: string | null;
  to_addr?: string | null;
  message_id: string;
  attachment_index?: number;
  subject?: string | null;
  mime?: string | null;
  size_bytes?: number | null;
  source?: DocumentSource;
  status?: DocumentStatus;
  /**
   * The provider-supplied receipt timestamp (PRD 01 FR6). When present, stored as
   * `received_at` in the DB so the column reflects the actual delivery time rather
   * than the insert time. Falls back to `now()` via the column default when omitted.
   */
  received_at?: Date | string | null;
}

/**
 * Insert a document, deduping on (message_id, attachment_index). Returns the row and
 * whether it was newly created — on a dedup hit the existing row is returned with
 * `created: false` (drivers resend the same email; never make a duplicate).
 */
async function insert(doc: DocumentInput): Promise<{ document: Document; created: boolean }> {
  const attachmentIndex = doc.attachment_index ?? 0;
  // Normalize received_at: accept Date, ISO string, or null/undefined (→ use DB default now()).
  const receivedAt =
    doc.received_at instanceof Date
      ? doc.received_at.toISOString()
      : (doc.received_at ?? null);
  const inserted = await query<Document>(
    `insert into document
       (driver_id, r2_key, from_addr, to_addr, message_id, attachment_index,
        subject, mime, size_bytes, source, status, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             coalesce($10, 'forwarded'), coalesce($11, 'received'),
             coalesce($12::timestamptz, now()))
     on conflict (message_id, attachment_index) do nothing
     returning *`,
    [
      doc.driver_id ?? null,
      doc.r2_key,
      doc.from_addr ?? null,
      doc.to_addr ?? null,
      doc.message_id,
      attachmentIndex,
      doc.subject ?? null,
      doc.mime ?? null,
      doc.size_bytes ?? null,
      doc.source ?? null,
      doc.status ?? null,
      receivedAt,
    ],
  );

  if (inserted[0]) {
    return { document: inserted[0], created: true };
  }

  // Conflict: fetch and return the pre-existing row.
  const existing = await query<Document>(
    `select * from document where message_id = $1 and attachment_index = $2`,
    [doc.message_id, attachmentIndex],
  );
  return { document: existing[0]!, created: false };
}

/**
 * Atomically claim the oldest `received` document for extraction and flip it to
 * `processing` in the SAME statement. The FOR UPDATE SKIP LOCKED subquery lets many
 * workers pull without contention, and because the status change is part of the claim
 * (not a later, separate write), a second worker can never re-claim the same row — the
 * prior implementation released the row lock at COMMIT before the caller changed status,
 * so two workers could process one document. Returns null when the queue is empty.
 *
 * (A crashed worker leaves a doc in `processing`; a stale-`processing` reaper is future
 * work — out of scope for the POC's single-worker pilot.)
 */
async function claimNextReceived(): Promise<Document | null> {
  const rows = await query<Document>(
    `update document
        set status = 'processing'
      where id = (
        select id from document
         where status = 'received'
         order by received_at asc
         for update skip locked
         limit 1
      )
     returning *`,
  );
  return rows[0] ?? null;
}

async function setStatus(id: string, status: DocumentStatus): Promise<void> {
  await query(`update document set status = $2 where id = $1`, [id, status]);
}

/**
 * Console review queue: documents in `ready_for_review` or `extraction_failed`, each
 * with its latest extraction (or null). Lowest overall confidence first so the asesor
 * sees the riskiest extractions at the top; failed docs (no confidence) sort first.
 */
async function listForReview(): Promise<Array<Document & { extraction: Extraction | null }>> {
  return query<Document & { extraction: Extraction | null }>(
    `select d.*,
            case when e.id is not null then to_jsonb(e.*) else null end as extraction
       from document d
       left join lateral (
         select * from extraction ex
          where ex.document_id = d.id
          order by ex.created_at desc
          limit 1
       ) e on true
      where d.status in ('ready_for_review', 'extraction_failed')
      order by coalesce((e.confidence->>'overall')::float, -1) asc, d.received_at asc`,
  );
}

/** Fetch one document with its latest extraction (or null), or null if not found. */
async function get(id: string): Promise<(Document & { extraction: Extraction | null }) | null> {
  const rows = await query<Document & { extraction: Extraction | null }>(
    `select d.*,
            case when e.id is not null then to_jsonb(e.*) else null end as extraction
       from document d
       left join lateral (
         select * from extraction ex
          where ex.document_id = d.id
          order by ex.created_at desc
          limit 1
       ) e on true
      where d.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export const documents = { insert, claimNextReceived, setStatus, listForReview, get };

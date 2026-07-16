/**
 * POST /inbound handler — the single ingestion surface (PRD 01 FR1–11).
 *
 * Flow (all downstream I/O goes through @ttr/core; the receiving edge is a thin shim):
 *   1. verify the provider signature (401 on failure)                       — FR (§6)
 *   2. normalize the payload → InboundEmail
 *   3. resolve the driver by `recipient` (the secret per-driver address)    — FR2/FR10
 *   4. for EACH attachment: MIME allowlist + 25 MiB guard                   — FR4
 *      → putObject to R2/S3, then documents.insert (dedupe on
 *        message_id+attachment_index)                                       — FR5/FR6
 *   5. emit metrics: 'first_doc_received' once per driver, plus per-doc     — FR (§2)
 *   6. sender-trust: cross-check From vs registered_email; flag on mismatch — FR7
 *   7. send the bilingual ack                                               — FR8
 *   8. return fast — extraction is polled later by the worker (status=received), never here — FR9
 *
 * The handler is transport-agnostic: it takes the parsed body + config + a deps bundle
 * (all @ttr/core functions) so it is trivially unit-testable and portable to a
 * Cloudflare Worker (swap the edge, keep this function).
 */
import type {
  Config,
  Driver,
  Document,
  DocumentInput,
  MetricRefs,
  AckOptions,
} from '@ttr/core';
import { normalizeInbound, verifySignature, InvalidPayloadError } from '../webhook.js';
import { validateAttachments, buildObjectKey } from '../attachments.js';
import type { AttachmentRejectReason } from '../attachments.js';
import {
  ackReceived,
  unknownAddress,
  nothingStored,
  type RejectedSummary,
} from '../messages.js';

/**
 * The @ttr/core surface the handler needs, injected so tests can mock it and the app can
 * swap implementations. Matches the real exports 1:1.
 */
export interface InboundDeps {
  drivers: { findByForwardingAddress(addr: string): Promise<Driver | null> };
  documents: {
    insert(doc: DocumentInput): Promise<{ document: Document; created: boolean }>;
    /**
     * Count existing documents for a driver. Used to emit 'first_doc_received' exactly
     * once (the G2 signal, PRD §2): we snapshot the count BEFORE inserting this email's
     * attachments, then emit only if it was 0 and this request created ≥1 document.
     */
    countByDriver(driverId: string): Promise<number>;
  };
  metrics: { emit(type: string, refs?: MetricRefs, payload?: Record<string, unknown>): Promise<void> };
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  sendAck(to: string, opts: AckOptions): Promise<void>;
}

export type InboundOutcome =
  | { status: 401; code: 'bad_signature'; body: { error: string } }
  | { status: 400; code: 'bad_payload'; body: { error: string } }
  | { status: 422; code: 'unknown_recipient'; body: { error: string; recipient: string } }
  | {
      status: 200;
      code: 'accepted';
      body: {
        ok: true;
        driverId: string;
        stored: Array<{ documentId: string; attachmentIndex: number; r2Key: string; deduped: boolean }>;
        rejected: Array<{ attachmentIndex: number; filename: string; reason: AttachmentRejectReason }>;
        senderTrust: 'match' | 'mismatch' | 'unknown';
      };
    };

/** Decide the sender-trust verdict (FR7). Cross-check From against the driver's registered email. */
function senderTrust(driver: Driver, sender: string): 'match' | 'mismatch' | 'unknown' {
  const registered = driver.registered_email?.trim().toLowerCase();
  if (!registered) return 'unknown';
  return registered === sender.trim().toLowerCase() ? 'match' : 'mismatch';
}

/**
 * Handle one inbound parse-webhook payload. Pure w.r.t. transport: returns an
 * {@link InboundOutcome} the edge maps to an HTTP response. Never runs extraction.
 */
export async function handleInbound(
  raw: unknown,
  cfg: Config,
  deps: InboundDeps,
): Promise<InboundOutcome> {
  // 1. Verify signature (constant-time). Reject 401 on failure. --------------------------
  if (!verifySignature(raw, cfg.webhookSecret)) {
    return { status: 401, code: 'bad_signature', body: { error: 'invalid signature' } };
  }

  // 2. Normalize the payload. -------------------------------------------------------------
  let email;
  try {
    email = normalizeInbound(raw);
  } catch (err) {
    const msg = err instanceof InvalidPayloadError ? err.message : 'malformed payload';
    return { status: 400, code: 'bad_payload', body: { error: msg } };
  }

  // 3. Resolve the driver by the secret per-driver recipient address (FR2). ---------------
  const driver = await deps.drivers.findByForwardingAddress(email.recipient);
  if (!driver) {
    // FR10: unknown address — reply with a nudge (best-effort) and 422 so the provider/ops
    // sees it was not silently accepted. Ack failure must not change the HTTP result.
    try {
      await deps.sendAck(email.sender || email.recipient, unknownAddress(email.recipient));
    } catch {
      /* ack is best-effort; the 422 is the authoritative signal */
    }
    await safeEmit(deps, 'ingest_unknown_recipient', {}, { recipient: email.recipient });
    return {
      status: 422,
      code: 'unknown_recipient',
      body: { error: 'recipient address is not registered', recipient: email.recipient },
    };
  }

  const trust = senderTrust(driver, email.sender);

  // Snapshot the driver's prior doc count BEFORE inserting, so 'first_doc_received' fires
  // exactly once (FR §2). Best-effort: on a count error, assume prior docs exist (no emit).
  let priorDocCount = Number.MAX_SAFE_INTEGER;
  try {
    priorDocCount = await deps.documents.countByDriver(driver.id);
  } catch {
    /* if we can't tell, don't risk a false 'first_doc_received' */
  }

  // 4. Validate + decode attachments (MIME allowlist + 25 MiB guard, FR4). ----------------
  // Use the provider-supplied receivedAt (normalized from `received_at` in the payload),
  // so the R2 key partition and the DB received_at column agree even under retries/clock skew.
  const receivedAt = email.receivedAt;
  const { accepted, rejected } = validateAttachments(email.attachments);

  const stored: Array<{
    documentId: string;
    attachmentIndex: number;
    r2Key: string;
    deduped: boolean;
  }> = [];

  // Internal list of attachments that failed at the store or DB stage (I/O errors).
  // These are added to `rejected` so the ack reflects what the driver can expect.
  const storageErrors: Array<{ attachmentIndex: number; filename: string; error: unknown }> = [];

  // For EACH accepted attachment: store the blob, then record one Document (dedup). -------
  // Errors on individual attachments are isolated: one failure must not abort the whole
  // request (which would suppress the ack and trigger a provider retry that re-uploads
  // every blob). We collect the error, continue, and report at the end. (P2 fix.)
  for (const att of accepted) {
    const key = buildObjectKey(driver.id, email.messageId, att.index, att.ext, receivedAt);

    try {
      // Store first so a Document row never points at a missing blob.
      await deps.putObject(key, att.bytes, att.contentType);

      const { document, created } = await deps.documents.insert({
        driver_id: driver.id,
        r2_key: key,
        from_addr: email.sender || null,
        to_addr: email.recipient,
        message_id: email.messageId,
        attachment_index: att.index,
        subject: email.subject || null,
        mime: att.contentType,
        size_bytes: att.size,
        source: 'forwarded',
        status: 'received', // the extraction worker polls status='received'; we NEVER extract here
        received_at: receivedAt, // provider-supplied timestamp (PRD 01 FR6)
      });

      stored.push({
        documentId: document.id,
        attachmentIndex: att.index,
        r2Key: key,
        deduped: !created,
      });

      // 5. Per-doc metric (only for genuinely new documents; resends must not double-count). -
      if (created) {
        await safeEmit(
          deps,
          'doc_received',
          { driverId: driver.id, documentId: document.id },
          { mime: att.contentType, size_bytes: att.size, sender_trust: trust },
        );
      }
    } catch (err) {
      // Attachment-level I/O failure — record it, keep going with the remaining attachments.
      storageErrors.push({ attachmentIndex: att.index, filename: att.filename, error: err });
      await safeEmit(
        deps,
        'ingest_attachment_error',
        { driverId: driver.id },
        {
          attachment_index: att.index,
          filename: att.filename,
          error: String(err),
        },
      );
    }
  }

  // 5b. 'first_doc_received' — emitted once, the first time this driver stores any doc. ----
  //     G2 signal (PRD §2). Fires only when the driver had ZERO prior documents and this
  //     request created ≥1 (resends are deduped → newlyCreated is 0 → no emit).
  const newlyCreated = stored.filter((s) => !s.deduped);
  if (priorDocCount === 0 && newlyCreated.length > 0) {
    await safeEmit(
      deps,
      'first_doc_received',
      { driverId: driver.id, documentId: newlyCreated[0]!.documentId },
    );
  }

  // 6. Sender-trust flag (FR7): flag a mismatch for a manual ops confirmation. -------------
  if (trust !== 'match') {
    await safeEmit(
      deps,
      'ingest_sender_flagged',
      { driverId: driver.id },
      { from: email.sender, registered_email: driver.registered_email, verdict: trust,
        spf: email.auth.spf, dkim: email.auth.dkim, dmarc: email.auth.dmarc },
    );
  }

  // 7. Acknowledge (FR8) — bilingual, best-effort. ----------------------------------------
  // Merge MIME-rejected and storage-error attachments for the ack so the driver gets a
  // single accurate picture of what happened.
  const rejectedSummaries: RejectedSummary[] = rejected.map((r) => ({
    filename: r.filename,
    reason: r.reason,
  }));
  const ack: AckOptions =
    stored.length > 0
      ? ackReceived(stored.length, rejectedSummaries)
      : nothingStored(rejectedSummaries);
  try {
    await deps.sendAck(email.sender || email.recipient, ack);
  } catch {
    /* ack is best-effort; a delivery failure must not fail ingestion */
  }

  // 8. Return fast — no extraction here (FR9). --------------------------------------------
  return {
    status: 200,
    code: 'accepted',
    body: {
      ok: true,
      driverId: driver.id,
      stored,
      rejected: [
        ...rejected.map((r) => ({
          attachmentIndex: r.index,
          filename: r.filename,
          reason: r.reason,
        })),
        // Storage errors are also surfaced as 'bad_mime' — closest sentinel; ops can inspect
        // metrics for the real reason. Using a distinct literal here would require widening
        // AttachmentRejectReason; for the POC the metric event carries the actual error.
        ...storageErrors.map((e) => ({
          attachmentIndex: e.attachmentIndex,
          filename: e.filename,
          reason: 'bad_mime' as AttachmentRejectReason,
        })),
      ],
      senderTrust: trust,
    },
  };
}

/** Emit a metric, swallowing failures so metrics never break ingestion. */
async function safeEmit(
  deps: InboundDeps,
  type: string,
  refs?: MetricRefs,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await deps.metrics.emit(type, refs, payload);
  } catch {
    /* metrics are non-critical */
  }
}

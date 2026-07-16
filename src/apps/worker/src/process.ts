/**
 * Extraction worker — the per-document pipeline (PRD 02 §5).
 *
 * One document flows: claim (SKIP LOCKED) → download blob → extract (one vision call,
 * mocked by default) → persist Extraction (fields + confidence + model, ready_for_review)
 * → set Document ready_for_review → emit `extraction_done`. Transient failures retry with
 * backoff; after N attempts the document is flagged `extraction_failed` and an
 * `extraction_failed` metric is emitted so the console surfaces it for manual entry —
 * a document is NEVER silently dropped (PRD 02 §5.5, §11).
 *
 * Everything the pipeline touches is injected via {@link ProcessDeps} so `processOnce`
 * is a pure, DB/S3-free unit under test: pass stub repos + an in-memory blob store + a
 * fake extractor and assert the state transitions.
 */
import {
  loadConfig,
  makeExtractor,
  documents as documentsRepo,
  extractions as extractionsRepo,
  metrics as metricsRepo,
} from '@ttr/core';
import type { Config, Document, Extractor, ExtractResult } from '@ttr/core';
import { s3BlobStore } from './storage.js';
import type { BlobStore } from './storage.js';

// ---------------------------------------------------------------------------
// Injectable dependencies (real defaults in `defaultDeps`).
// ---------------------------------------------------------------------------

/** The slice of the `documents` repo the worker uses. */
export interface DocumentsPort {
  claimNextReceived(): Promise<Document | null>;
  setStatus(id: string, status: Document['status']): Promise<void>;
}

/** The slice of the `extractions` repo the worker uses. */
export interface ExtractionsPort {
  insert(x: {
    document_id: string;
    fields: ExtractResult['fields'];
    confidence: ExtractResult['confidence'];
    model: string;
    status?: string;
  }): Promise<{ id: string }>;
}

/** The slice of the `metrics` repo the worker uses. */
export interface MetricsPort {
  emit(
    type: string,
    refs?: { documentId?: string; driverId?: string },
    payload?: Record<string, unknown>,
  ): Promise<void>;
}

export interface RetryConfig {
  /** Total attempts at the extract step before giving up (>= 1). */
  maxAttempts: number;
  /** Base backoff in ms; attempt N waits baseDelayMs * 2^(N-1). */
  baseDelayMs: number;
}

export interface ProcessDeps {
  documents: DocumentsPort;
  extractions: ExtractionsPort;
  metrics: MetricsPort;
  blobs: BlobStore;
  /** Build the extractor for a document (defaults to the config-driven factory). */
  makeExtractor: () => Extractor;
  retry: RetryConfig;
  /** Sleep hook — overridden in tests to avoid real waits. */
  sleep: (ms: number) => Promise<void>;
  /** Structured log sink (defaults to console). */
  log: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Result descriptors (returned by processOnce for the loop + tests).
// ---------------------------------------------------------------------------

export type ProcessOutcome =
  | { status: 'idle' } // queue empty
  | { status: 'ready_for_review'; documentId: string; extractionId: string; overall: number }
  | { status: 'extraction_failed'; documentId: string; error: string };

// ---------------------------------------------------------------------------
// Defaults — wire the real @ttr/core repos, S3 blob store, and config factory.
// ---------------------------------------------------------------------------

/** Errors matching these are treated as transient (worth a retry) rather than terminal. */
const TRANSIENT_PATTERNS =
  /rate.?limit|timeout|timed out|429|50\d|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|throttl|temporar|unavailable|overloaded/i;

/**
 * Heuristic: is this error worth retrying? Only errors that look like rate
 * limits / timeouts / 5xx / connection blips are transient; anything else
 * (e.g. a malformed image or a schema-validation failure) fails fast, since
 * retrying a deterministic error just delays the `extraction_failed` flag.
 */
export function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return TRANSIENT_PATTERNS.test(msg);
}

function consoleLog(
  level: 'info' | 'warn' | 'error',
  msg: string,
  extra?: Record<string, unknown>,
): void {
  const line = { ts: new Date().toISOString(), level, msg, ...(extra ?? {}) };
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Build the default, production dependency set from config + @ttr/core. */
export function defaultDeps(cfg: Config = loadConfig()): ProcessDeps {
  return {
    documents: {
      claimNextReceived: () => documentsRepo.claimNextReceived(),
      setStatus: (id, status) => documentsRepo.setStatus(id, status),
    },
    extractions: {
      insert: (x) => extractionsRepo.insert(x),
    },
    metrics: {
      emit: (type, refs, payload) => metricsRepo.emit(type, refs, payload),
    },
    blobs: s3BlobStore,
    makeExtractor: () => makeExtractor(cfg),
    retry: { maxAttempts: 3, baseDelayMs: 500 },
    sleep,
    log: consoleLog,
  };
}

// ---------------------------------------------------------------------------
// Pipeline.
// ---------------------------------------------------------------------------

/** Derive a filename for the extractor from the R2 key (its basename). */
function filenameFromKey(key: string): string {
  const parts = key.split('/');
  return parts[parts.length - 1] || key;
}

/**
 * Generic bounded-retry helper with exponential backoff on transient errors.
 * Non-transient errors fail fast (no retry). Throws the last error if every attempt fails.
 *
 * @param fn        - The async operation to retry.
 * @param deps      - Process dependencies (retry config, sleep, log).
 * @param documentId - Used only for structured log lines.
 * @param label     - Short descriptor for the log (e.g. 'download', 'extract').
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  deps: ProcessDeps,
  documentId: string,
  label: string,
): Promise<T> {
  const { maxAttempts, baseDelayMs } = deps.retry;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = isTransient(err);
      const more = attempt < maxAttempts;
      deps.log('warn', `${label} attempt failed`, {
        documentId,
        attempt,
        maxAttempts,
        transient,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!transient || !more) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await deps.sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Process a single already-claimed document end to end. Idempotent: the extraction
 * UPSERT on (document_id) atomically overwrites any prior row. On unrecoverable failure
 * it flags the document `extraction_failed` and emits a metric (never drops it).
 */
export async function processDocument(
  doc: Document,
  deps: ProcessDeps,
): Promise<ProcessOutcome> {
  const documentId = doc.id;
  const driverId = doc.driver_id ?? undefined;
  try {
    deps.log('info', 'processing document', { documentId, r2_key: doc.r2_key });

    // Wrap blob download in the same transient-retry logic (PRD 02 §5 — S3/MinIO blips
    // such as ETIMEDOUT, ECONNRESET, or 503 are transient; NoSuchKey is not and fails fast).
    const buffer = await withRetry(
      () => deps.blobs.getObject(doc.r2_key),
      deps,
      documentId,
      'download',
    );
    const extractor = deps.makeExtractor();
    const result = await withRetry(
      () =>
        extractor.extract({
          buffer,
          mime: doc.mime ?? 'application/octet-stream',
          filename: filenameFromKey(doc.r2_key),
        }),
      deps,
      documentId,
      'extract',
    );

    // Idempotency: UPSERT on (document_id) atomically overwrites any prior extraction row.
    const extraction = await deps.extractions.insert({
      document_id: documentId,
      fields: result.fields,
      confidence: result.confidence,
      model: result.model,
      status: 'ready_for_review',
    });

    await deps.documents.setStatus(documentId, 'ready_for_review');

    const overall = result.confidence?.overall ?? 0;
    await deps.metrics.emit(
      'extraction_done',
      { documentId, driverId },
      {
        model: result.model,
        overall,
        // A wrong VAT ID kills a claim — surface whether the model even produced one.
        has_vat_id: Boolean(result.fields?.vatId),
        line_items: result.fields?.lineItems?.length ?? 0,
      },
    );

    deps.log('info', 'document ready_for_review', {
      documentId,
      extractionId: extraction.id,
      overall,
    });
    return { status: 'ready_for_review', documentId, extractionId: extraction.id, overall };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log('error', 'extraction failed — flagging document', { documentId, error: message });
    // Never drop: flag for the asesor's manual-entry queue and record the failure.
    try {
      await deps.documents.setStatus(documentId, 'extraction_failed');
      await deps.metrics.emit('extraction_failed', { documentId, driverId }, { error: message });
    } catch (secondary) {
      deps.log('error', 'failed to flag extraction_failed', {
        documentId,
        error: secondary instanceof Error ? secondary.message : String(secondary),
      });
    }
    return { status: 'extraction_failed', documentId, error: message };
  }
}

/**
 * Claim and process at most one document. Returns `{ status: 'idle' }` when the queue
 * is empty. Safe to call in a loop (poller) or once (tests / a one-shot invocation).
 */
export async function processOnce(deps: ProcessDeps = defaultDeps()): Promise<ProcessOutcome> {
  const doc = await deps.documents.claimNextReceived();
  if (!doc) return { status: 'idle' };
  return processDocument(doc, deps);
}

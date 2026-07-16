import { describe, it, expect } from 'vitest';
import { MockExtractor } from '@ttr/core';
import type { Document, Extractor, ExtractInput, ExtractResult } from '@ttr/core';
import { processOnce, isTransient } from '../process.js';
import type { ProcessDeps } from '../process.js';

// ---------------------------------------------------------------------------
// In-memory harness — no Postgres, no S3, no network. Records every state change.
// ---------------------------------------------------------------------------

interface Harness {
  deps: ProcessDeps;
  statuses: string[]; // document status transitions, in order
  extractions: Array<{ document_id: string; model: string; overall: number }>;
  cleared: string[]; // documentIds whose prior extractions were cleared
  metrics: Array<{ type: string; payload?: Record<string, unknown> }>;
}

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    driver_id: 'drv-1',
    r2_key: 'receipts/drv-1/2025/01/msg-1-0.jpg',
    from_addr: 'juan@example.com',
    to_addr: 'juan.perez@ingest.ttr.example',
    message_id: 'msg-1',
    attachment_index: 0,
    subject: 'receipt',
    mime: 'image/jpeg',
    size_bytes: 1234,
    source: 'forwarded',
    status: 'received',
    received_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

interface HarnessOpts {
  queue?: Document[];
  extractor?: Extractor;
  blob?: (key: string) => Promise<Buffer>;
  maxAttempts?: number;
}

function makeHarness(opts: HarnessOpts = {}): Harness {
  const queue = [...(opts.queue ?? [makeDoc()])];
  const statuses: string[] = [];
  const extractions: Harness['extractions'] = [];
  const cleared: string[] = [];
  const metrics: Harness['metrics'] = [];
  let extractionSeq = 0;

  const deps: ProcessDeps = {
    documents: {
      async claimNextReceived() {
        return queue.shift() ?? null;
      },
      async setStatus(_id, status) {
        statuses.push(status);
      },
    },
    extractions: {
      async insert(x) {
        extractions.push({
          document_id: x.document_id,
          model: x.model,
          overall: x.confidence.overall,
        });
        return { id: `ext-${++extractionSeq}` };
      },
    },
    metrics: {
      async emit(type, _refs, payload) {
        metrics.push({ type, payload });
      },
    },
    blobs: {
      getObject: opts.blob ?? (async () => Buffer.from('synthetic-bytes')),
    },
    makeExtractor: () => opts.extractor ?? new MockExtractor(),
    clearExtractions: async (documentId) => {
      cleared.push(documentId);
    },
    retry: { maxAttempts: opts.maxAttempts ?? 3, baseDelayMs: 1 },
    sleep: async () => {}, // never actually wait in tests
    log: () => {},
  };

  return { deps, statuses, extractions, cleared, metrics };
}

// A fixed extractor with line items, so we assert multi-line fuel-card handling.
class LineItemExtractor implements Extractor {
  readonly model = 'test-lineitems';
  async extract(_input: ExtractInput): Promise<ExtractResult> {
    return {
      model: this.model,
      fields: {
        vatId: 'FR123456789',
        date: '2025-03-01',
        gross: 300,
        vat: 50,
        currency: 'EUR',
        country: 'FR',
        category: 'fuel',
        lineItems: [
          { vatId: 'FR123456789', date: '2025-03-01', gross: 100, vat: 16.67, country: 'FR', category: 'fuel' },
          { vatId: 'FR123456789', date: '2025-03-05', gross: 200, vat: 33.33, country: 'FR', category: 'toll' },
        ],
      },
      confidence: { overall: 0.9, perField: { vatId: 0.9, date: 0.95, gross: 0.98, vat: 0.9 } },
    };
  }
}

// An extractor that always throws — drives the forced-failure path.
class AlwaysFailExtractor implements Extractor {
  readonly model = 'always-fail';
  private readonly message: string;
  constructor(message = 'permanent boom') {
    this.message = message;
  }
  async extract(): Promise<ExtractResult> {
    throw new Error(this.message);
  }
}

// Transient-then-succeed: throws a retryable error the first N-1 times.
class FlakyExtractor implements Extractor {
  readonly model = 'flaky';
  private calls = 0;
  private readonly failFor: number;
  constructor(failFor: number) {
    this.failFor = failFor;
  }
  async extract(input: ExtractInput): Promise<ExtractResult> {
    this.calls++;
    if (this.calls <= this.failFor) throw new Error('rate limit exceeded (429)');
    return new MockExtractor().extract(input);
  }
}

// ---------------------------------------------------------------------------

describe('processOnce — happy path', () => {
  it('turns a received doc into ready_for_review with a persisted Extraction', async () => {
    const h = makeHarness();
    const outcome = await processOnce(h.deps);

    expect(outcome.status).toBe('ready_for_review');
    if (outcome.status !== 'ready_for_review') throw new Error('unreachable');
    expect(outcome.documentId).toBe('doc-1');
    expect(outcome.extractionId).toBe('ext-1');

    // A single Extraction was written with the mock's model + confidence.
    expect(h.extractions).toHaveLength(1);
    expect(h.extractions[0]!.model).toBe('mock-vision-0');
    expect(h.extractions[0]!.overall).toBeGreaterThan(0);

    // The document was advanced to ready_for_review (and never marked failed).
    expect(h.statuses).toEqual(['ready_for_review']);

    // The extraction_done metric fired (not extraction_failed).
    expect(h.metrics.map((m) => m.type)).toContain('extraction_done');
    expect(h.metrics.map((m) => m.type)).not.toContain('extraction_failed');
  });

  it('clears prior extractions before inserting (idempotent re-runs)', async () => {
    const h = makeHarness();
    await processOnce(h.deps);
    expect(h.cleared).toEqual(['doc-1']);
  });

  it('returns idle when the queue is empty', async () => {
    const h = makeHarness({ queue: [] });
    const outcome = await processOnce(h.deps);
    expect(outcome.status).toBe('idle');
    expect(h.extractions).toHaveLength(0);
    expect(h.statuses).toEqual([]);
  });

  it('handles multi-line fuel-card invoices via fields.lineItems', async () => {
    const h = makeHarness({ extractor: new LineItemExtractor() });
    const outcome = await processOnce(h.deps);
    expect(outcome.status).toBe('ready_for_review');
    const done = h.metrics.find((m) => m.type === 'extraction_done');
    expect(done?.payload?.line_items).toBe(2);
  });

  it('routes an illegible image to review with low confidence, not fabricated fields', async () => {
    const doc = makeDoc({ r2_key: 'receipts/drv-1/2025/01/illegible-blur.jpg' });
    const h = makeHarness({ queue: [doc] });
    const outcome = await processOnce(h.deps);
    // Low confidence still goes to the asesor's review queue (POC reviews everything).
    expect(outcome.status).toBe('ready_for_review');
    if (outcome.status !== 'ready_for_review') throw new Error('unreachable');
    expect(outcome.overall).toBeLessThan(0.5);
    expect(h.statuses).toEqual(['ready_for_review']);
  });

  it('recovers after transient failures and still succeeds', async () => {
    const h = makeHarness({ extractor: new FlakyExtractor(2), maxAttempts: 3 });
    const outcome = await processOnce(h.deps);
    expect(outcome.status).toBe('ready_for_review');
    expect(h.statuses).toEqual(['ready_for_review']);
    expect(h.metrics.map((m) => m.type)).toContain('extraction_done');
  });
});

describe('processOnce — forced failure path', () => {
  it('flags the document extraction_failed and emits a metric (never drops it)', async () => {
    const h = makeHarness({ extractor: new AlwaysFailExtractor('permanent boom'), maxAttempts: 2 });
    const outcome = await processOnce(h.deps);

    expect(outcome.status).toBe('extraction_failed');
    if (outcome.status !== 'extraction_failed') throw new Error('unreachable');
    expect(outcome.error).toMatch(/permanent boom/);

    // No extraction row was written; the document was flagged for manual entry.
    expect(h.extractions).toHaveLength(0);
    expect(h.statuses).toEqual(['extraction_failed']);

    // The failure was recorded, not dropped.
    const types = h.metrics.map((m) => m.type);
    expect(types).toContain('extraction_failed');
    expect(types).not.toContain('extraction_done');
  });

  it('treats a non-transient blob-download error as a failure (flags the doc)', async () => {
    const h = makeHarness({
      blob: async () => {
        throw new Error('object not found');
      },
    });
    const outcome = await processOnce(h.deps);
    expect(outcome.status).toBe('extraction_failed');
    expect(h.statuses).toEqual(['extraction_failed']);
  });

  it('retries a transient blob-download error and succeeds on recovery (P1 fix)', async () => {
    // First call throws a transient error; second call returns bytes.
    let blobCalls = 0;
    const h = makeHarness({
      blob: async () => {
        blobCalls++;
        if (blobCalls === 1) throw new Error('ECONNRESET');
        return Buffer.from('synthetic-bytes');
      },
      maxAttempts: 3,
    });
    const outcome = await processOnce(h.deps);
    expect(outcome.status).toBe('ready_for_review');
    expect(blobCalls).toBe(2);
    expect(h.statuses).toEqual(['ready_for_review']);
    expect(h.metrics.map((m) => m.type)).toContain('extraction_done');
    expect(h.metrics.map((m) => m.type)).not.toContain('extraction_failed');
  });

  it('fails permanently when transient blob errors exhaust all retry attempts', async () => {
    const h = makeHarness({
      blob: async () => {
        throw new Error('503 Service Unavailable');
      },
      maxAttempts: 2,
    });
    const outcome = await processOnce(h.deps);
    expect(outcome.status).toBe('extraction_failed');
    if (outcome.status !== 'extraction_failed') throw new Error('unreachable');
    expect(outcome.error).toMatch(/503/);
    expect(h.statuses).toEqual(['extraction_failed']);
    expect(h.metrics.map((m) => m.type)).toContain('extraction_failed');
  });
});

describe('isTransient classification', () => {
  it('flags rate limits / timeouts / 5xx as transient', () => {
    expect(isTransient(new Error('rate limit exceeded'))).toBe(true);
    expect(isTransient(new Error('request timed out'))).toBe(true);
    expect(isTransient(new Error('503 Service Unavailable'))).toBe(true);
    expect(isTransient(new Error('ECONNRESET'))).toBe(true);
  });
  it('does not retry a plain validation error', () => {
    expect(isTransient(new Error('invalid image dimensions'))).toBe(false);
  });
});

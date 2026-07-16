# @ttr/worker — extraction worker (PRD 02)

The POC's single piece of automated intelligence. A long-running poller that turns a
stored receipt (image/PDF) into **structured fields + a confidence score** and marks the
document `ready_for_review` for the asesor. Per the confirmed build boundary, the
automated pipeline **stops here** — the human does reconciliation, validation, the €
calc, and filing.

## What it does (per document)

`claim → download → extract → persist → advance → emit`

1. **Claim** the oldest `received` document with `documents.claimNextReceived()`
   (`FOR UPDATE SKIP LOCKED`, so several workers can run without contention).
2. **Download** the R2/MinIO object bytes (`src/storage.ts`, same S3 config as `@ttr/core`).
3. **Extract** with `makeExtractor(cfg).extract()` — one vision call behind a swappable
   interface. Defaults to a deterministic **MOCK** (`EXTRACTION_MOCK=true`, no network).
4. **Persist** an `Extraction` (`fields` + `confidence` + `model`, status
   `ready_for_review`). Prior extractions for the document are cleared first, so a
   **re-run overwrites** rather than duplicates (idempotent per `document_id`).
5. **Advance** the document to `ready_for_review` (`documents.setStatus`).
6. **Emit** `metric_event('extraction_done')` with the model + overall confidence.

### Failure handling (never drop)

- Transient errors (rate limits, timeouts, 5xx, connection resets — see `isTransient`)
  are **retried with exponential backoff** (`retry.maxAttempts`, `retry.baseDelayMs`).
- After the attempts are exhausted (or on a non-transient error), the document is flagged
  **`extraction_failed`** and an `extraction_failed` metric is emitted, so the console
  surfaces it in the review queue for **manual entry** (PRD 02 §5.5, §11). A document is
  **never silently dropped**.

### Multi-line fuel-card invoices

The highest-value backlog document. The extractor returns a per-line array in
`fields.lineItems[]`; the worker persists it verbatim inside `extraction.fields` (jsonb)
and reports the line count on the `extraction_done` metric. If a layout is too complex to
read reliably, the extractor returns **low confidence** and the asesor does manual entry
rather than the pipeline guessing (a wrong number kills a claim).

## Entry points

- `src/index.ts` — the poll loop. Drains the queue as fast as documents appear, idles
  `WORKER_IDLE_MS` (default 2000ms) when empty, and shuts down cleanly on SIGINT/SIGTERM.
  Run: `npm start` (`tsx src/index.ts`) from `apps/worker`.
- `src/process.ts` — `processOnce(deps?)` claims and processes **at most one** document
  and returns a `ProcessOutcome` (`idle` | `ready_for_review` | `extraction_failed`).
  This is the one-shot used by the loop **and** by tests. All I/O (repos, blob store,
  extractor, sleep, retry, log) is injected via `ProcessDeps`, so `processOnce` runs as a
  pure unit under vitest — no Postgres, S3, or network.

## Config

Reads env via `@ttr/core`'s `loadConfig()` (`infra/.env.example`): `DATABASE_URL`,
`S3_*` / `R2_BUCKET`, `EXTRACTION_MOCK`, `LLM_API_KEY`. Worker-local knobs:

| env | default | meaning |
|---|---|---|
| `EXTRACTION_MOCK` | `true` | deterministic offline mock extractor (no LLM call) |
| `WORKER_IDLE_MS`  | `2000` | idle interval when the queue is empty |

## Tests

`npm test` (vitest). `src/__tests__/process.test.ts` covers: received → `ready_for_review`
with a persisted Extraction; the forced-failure path → `extraction_failed` (never
dropped); idempotent re-run clears prior extractions; empty queue → `idle`; multi-line
`lineItems`; illegible image → low confidence but still routed to review; transient
retry-then-succeed; and the `isTransient` classifier.

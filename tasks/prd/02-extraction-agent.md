# PRD 02 · Extraction Pipeline & Orchestration

> **Status:** ✅ ready · **Phase:** POC · **Owner:** TBD
> **Related:** [00 · Overview](00-poc-overview.md) · [01 · Email ingestion](01-email-ingestion.md) ·
> [04 · Console](04-concierge-console.md) · [06 · Metrics](06-instrumentation-metrics.md) ·
> research: [orchestration brief](../research/02-agent-orchestration.md)

## 1. Summary

Turn a stored receipt image/PDF into **structured fields + a confidence score** with **one
LLM-vision call**, and persist it for the asesor. This is the *entire* automated intelligence
in the POC — per the confirmed build boundary, the **automated pipeline stops here** (§6 is the
seam where LangGraph/deep-agents would later plug in); the human does reconciliation,
validation, the € calc, and filing.

## 2. Which gate this serves

**G3 (≥90% extraction accuracy).** Extraction accuracy on the 4 key fields is measured
directly: the asesor's corrections in the console are ground truth ([06](06-instrumentation-metrics.md)).
Good extraction also makes the concierge fast enough to hit the €-recovery bar.

## 3. Goals / Non-goals

**Goals**
- Extract the **4 key fields** + supporting context from messy, multilingual receipts.
- Attach a **calibrated confidence** (per-field + overall) to prioritise asesor review.
- Be **provider-agnostic** and biased to the **lowest-hallucination** model.
- Run **durably** (retry on transient failure) without a heavyweight framework.

**Non-goals (deferred to MVP — see Migration path)**
- Second-extractor reconcile · automated validation (VIES, gross=net+VAT, date window) ·
  recoverable-€ computation · rules engine · any agentic "chase the missing data" behaviour ·
  filing. **All done by the human in the POC.**

## 4. The extraction contract

The **4 key fields** (accuracy is measured on these) plus context the asesor needs:

| Field | Notes |
|---|---|
| **Supplier VAT ID** | The claim-killer if wrong — flag low confidence aggressively. |
| **Invoice/receipt date** | For the claim-window check (human does the check). |
| **Gross amount** | Total incl. VAT. |
| **VAT amount** | The reclaim base. |
| *context:* currency, country, supplier name, fuel/toll/AdBlue category, litres (if present) | Helps the asesor; not scored. |

**Multi-page fuel-card monthly invoices** (the backlog's highest-value document — dossier §8)
carry many claim-relevant lines. For these, extract a **line-item array** (`fields.line_items[]`,
each with the 4 fields + country/category); if the layout is too complex to read reliably,
**return low confidence and route to asesor manual entry** ([04](04-concierge-console.md)) rather
than guessing — a wrong number kills a claim.

Output JSON: `{ fields: { vat_id, date, gross, vat, currency, country, supplier, category, litres, line_items[] }, confidence: { overall, per_field }, model, raw_notes }`. Persist as an
`Extraction` linked to the `Document`, status `ready_for_review`.

## 5. Functional requirements

1. Consume `{document_id}` from the ingest Workflow/Queue ([01](01-email-ingestion.md)); fetch the R2 object.
2. One **LLM-vision** call with a structured-output prompt returning the contract in §4.
3. Emit **per-field + overall confidence**; mark fields below threshold τ for prominent
   review (τ tunable; in the POC the asesor reviews everything, so confidence *prioritises*
   and colour-codes rather than gates).
4. Persist the `Extraction`; set the `Document` to `ready_for_review`; emit a metric event.
5. **Retry** transient failures (rate limits, timeouts) with backoff; after N failures, flag
   the document `extraction_failed` **and surface it in the console's review queue for manual
   entry** ([04](04-concierge-console.md)) — never silently drop.
6. **Idempotent** per `document_id` (re-runs overwrite, don't duplicate).
7. Handle non-receipts / illegible images: return low overall confidence + a reason, route to
   the asesor (don't hallucinate fields).

## 6. Approach / architecture — and the orchestration decision

**No agent framework in the POC.** Per the research brief, the pipeline is a fixed sequence
with one confidence branch — a **state machine + a single LLM call**, not autonomous planning.
Deep-agents' planning/sub-agents/virtual-filesystem would add tokens, latency,
non-determinism, and debugging surface for a planner we don't need over a money-moving,
auditable workflow.

- **POC:** a plain **Cloudflare Queue** consumer (with retries + a dead-letter queue), in
  TypeScript, on the same platform as ingest — the honest minimum for fetch → one call → write.
  A Cloudflare **Workflow** (`step.do` retries, `step.waitForEvent` for a durable asesor-review
  pause) is the **MVP upgrade** once the pipeline gains steps. State/records in Postgres
  ([03](03-data-model.md)).
- **Provider-agnostic LLM vision** (e.g. Claude vision) under an **EU-processing DPA**; keep the
  extractor behind a small interface so the model swaps without rework.

### Migration path — when LangGraph / deep-agents earns its place *(honors the original steer)*

1. **POC (now):** thin Cloudflare Workflow / queue, one LLM call. No framework.
2. **MVP:** add the **2nd extractor + reconcile + confidence**, automated **validation** (VIES,
   math, date window) and the **recoverable-€ rules**. If orchestration gets branchy, introduce
   **LangGraph.js** (still on Cloudflare) or a Python LangGraph service behind a queue — a low-risk
   lift because the steps are already isolated functions. `step.waitForEvent` / LangGraph
   `interrupt()` becomes the durable asesor-review pause.
3. **Platform:** when genuinely **open-ended sub-tasks** appear — an agent that *chases missing
   invoice data* over email threads, or reconciles unbounded document batches — introduce a
   **bounded LangGraph subgraph**, and adopt **`deepagents`** only if planning + sub-agents +
   virtual filesystem become the *dominant* pattern (not a one-off).

*(Premise corrections from the research: "deep agents = Python-only" is outdated — there's a TS
build (`deepagentsjs`) and LangGraph.js is at 1.0 parity; and human-in-the-loop is supported by
all three stacks, so it's not the deciding factor. The deciding factor is "the POC pipeline
isn't open-ended enough to need a framework yet.")*

## 7. Data & schema touched

Reads `Document` + the R2 object; writes `Extraction` (fields, confidence, model, status) and a
`MetricEvent` (extraction done). Shapes in [PRD 03](03-data-model.md).

## 8. Interfaces & contracts

- **In:** `{document_id}` from the ingest queue/workflow.
- **Out:** `Extraction` persisted; `Document.status = ready_for_review`; metric event emitted;
  console reads it ([04](04-concierge-console.md)).
- **LLM:** structured-output request/response behind a swappable `Extractor` interface.

## 9. Non-functional

- **Accuracy:** target ≥90% on the 4 fields (G3), measured from asesor corrections ([06](06-instrumentation-metrics.md)).
- **Hallucination bias:** prefer a lower-hallucination model; a wrong VAT ID is worse than a
  blank one (better to flag low-confidence than to guess).
- **GDPR:** document images leave EU storage only to the LLM vendor under a DPA with
  EU-processing terms; log what was sent, keep no unnecessary copies.
- **Cost:** dominated by vision tokens (independent of orchestrator); trivial at pilot volume.
- **Latency:** async; minutes are fine — the asesor works a queue.

## 10. Dependencies & sequencing

Needs [01](01-email-ingestion.md) (documents in R2 + queue) and [03](03-data-model.md)
(`Extraction`). Feeds [04](04-concierge-console.md) and [06](06-instrumentation-metrics.md).
Build WK 2–3.

## 11. Acceptance criteria

- A queued document yields a persisted `Extraction` with all 4 fields + per-field/overall
  confidence, `ready_for_review`, within minutes.
- Transient LLM failures retry and eventually succeed or land as `extraction_failed` (never
  dropped); re-runs are idempotent.
- Illegible/non-receipt inputs return low confidence + reason, not fabricated fields.
- Accuracy is computable from asesor corrections (the correction diff is captured).

## 12. Open questions & risks

1. **Model + EU DPA** — which vision model on messy multilingual fuel/toll invoices; EU processing terms.
2. **Confidence calibration** — does the model's self-reported confidence correlate with real
   accuracy? May need a heuristic (field-format checks) to make τ meaningful.
3. **Structured-output reliability** — enforce the JSON schema; handle refusals/partial reads.
4. **Compute limits** — does the vision call fit a Workflow step's CPU/time budget, or offload
   to a container/external function? (Verify current Cloudflare limits.)
5. **Fuel-card e-invoices vs photos** — PDFs may be cleaner than photos; consider a text path.

## 13. Out of scope / deferred

2nd extractor, VIES, validity/math/date checks, €-calculation, rules engine, filing, agentic
data-chasing, LangGraph/deep-agents (all per Migration path above).

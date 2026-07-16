# PRD 06 · Instrumentation & Pilot Metrics

> **Status:** ✅ ready · **Phase:** POC · **Owner:** TBD
> **Related:** [00 · Overview](00-poc-overview.md) · [03 · Data model](03-data-model.md) ·
> [04 · Console](04-concierge-console.md) · dossier [§8 gates](../../research/08-spain-pilot.html)

## 1. Summary

The POC exists to produce four numbers; this PRD makes sure they're captured honestly. A small
**event stream** + a handful of **dashboard views** measure the pilot's gates G1–G4 — and, per
the dossier, **measure € *filed*, not € *paid*** (cash lands months 4–8, after the POC ends).

## 2. Which gates this serves

All four — it *is* the measurement layer.

## 3. Goals / Non-goals

**Goals** — one append-only event model; gate dashboards; extraction accuracy from ground-truth
corrections; a clean go/no-go readout at WK 8.
**Non-goals** — a BI platform, real-time analytics, third-party product-analytics SDKs, revenue
reporting (no billing in the POC).

## 4. The four gates → metrics

| Gate | Metric | Source |
|---|---|---|
| **G1** Recruit | # carriers signed · CAC (≈€0 organic) | `Carrier` + `MetricEvent(carrier_signed)` |
| **G2** Authorize *(true gate)* | **% of onboarded who granted apoderamiento AND sent ≥1 doc** | `Authorization` + first `Document` per driver |
| **G3** Recover | **median € recovered / int'l truck** (target ≥€4k) · **extraction accuracy on the 4 fields** (target ≥90%) | `Claim.recoverable_eur` on filed claims ÷ trucks · `Extraction.corrected_fields` diffs |
| **G4** WTP | **% accepting ~15% fee** | `MetricEvent(wtp_response)` from interviews |
| Cross-cut | € identified vs **€ filed** · **cost-to-serve/claim** (from `Claim.asesor_minutes` × loaded rate) · time-to-file | `Claim.asesor_minutes` · `Claim` · `Filing` |

## 5. Functional requirements

1. **Event model** — every meaningful action emits a `MetricEvent` ([03](03-data-model.md)):
   `carrier_signed`, `authorization_granted`, `first_doc_received`, `extraction_done`,
   `field_corrected`, `claim_ready`, `claim_blocked`, `claim_filed`, `wtp_response`.
2. **Accuracy computation** — per corrected document, compare `fields` vs `corrected_fields`
   across the 4 key fields → field-level accuracy %, rolled up to the G3 number. Distinguish
   "confirmed correct" from "edited".
3. **€ recovered** — sum `recoverable_eur` on `filed` claims; median per international truck.
   Report **filed vs paid** separately; POC reports **filed**.
4. **WTP capture** — a simple form to log each carrier's fee-acceptance interview outcome.
5. **Gate dashboard** — one screen (SQL views on the low-code tool) with the G1–G4 tiles and the
   WK-8 go/no-go readout; per-driver recovery statement links ([04](04-concierge-console.md)).

## 6. Approach / architecture

No new stack: an append-only `metric_event` table + SQL views/materialised views, surfaced in
the same low-code admin as the console ([04](04-concierge-console.md)). Accuracy is a view over
`Extraction`. Keep it boring and trustworthy.

## 7. Data & schema touched

Reads all entities; writes `MetricEvent`. Canonical shapes in [PRD 03](03-data-model.md).

## 8. Interfaces & contracts

Every PRD's write path emits events; dashboards are read-only views. WTP form writes
`MetricEvent(wtp_response)`.

## 9. Non-functional

- **Honesty:** never conflate € filed with € paid; flag estimates; the two load-bearing numbers
  (≈€6k/truck, ~15% fee) are what these dashboards test — present them as results, not givens.
- **GDPR:** metrics use IDs/aggregates, not extra PII copies.
- **Auditability:** append-only, timestamped.

## 10. Dependencies & sequencing

Depends on [03](03-data-model.md); wired as each producing PRD lands (WK 2 onward); dashboards
firm up WK 3–8 for the WK-8 decision.

## 11. Acceptance criteria

- At WK 8, each gate (G1–G4) has a single defensible number with drill-down to source events.
- Extraction accuracy is derived from real asesor corrections, not self-reported confidence.
- € recovered is reported as **filed**, per truck, with the paid figure tracked separately.

## 12. Open questions & risks

1. **Accuracy definition** — exact-match vs normalised (dates/decimals/VAT-ID formatting); define
   before measuring so the ≥90% bar is meaningful.
2. **"International truck" denominator** — how to attribute claims to trucks for the median.
3. **CAC** — is it truly ≈€0, or should partner rev-share (Fenadismer) be counted?
4. **WTP method** — interview script + how to avoid leading answers on the 15%.

## 13. Out of scope / deferred

BI tooling, real-time streaming, product-analytics SDKs, cohort/retention analytics, revenue
reporting.

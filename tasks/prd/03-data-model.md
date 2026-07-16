# PRD 03 · Data Model & Persistence

> **Status:** ✅ ready · **Phase:** POC · **Owner:** TBD
> **Related:** [00 · Overview](00-poc-overview.md) · touched by every other PRD ·
> research: [orchestration §5](../research/02-agent-orchestration.md), [email §4/§6](../research/01-cloudflare-email-for-agents.md)

## 1. Summary

The shared data contract for the POC: a small relational schema (Postgres) plus EU-resident
blob storage (R2) that every other PRD reads and writes. Kept deliberately minimal — enough to
track a receipt from inbox to filed claim, measure the four gates, and satisfy AEAT/GDPR
record-keeping — with no schema for the automation we're intentionally faking with a human.

## 2. Which gates this serves

All of them, indirectly: the schema is what makes G2/G3/G4 *measurable* (authorization state,
extraction corrections, € filed per truck, WTP responses).

## 3. Goals / Non-goals

**Goals** — one canonical store; a clear document→extraction→claim→filing lifecycle; captured
provenance + corrections (ground truth for accuracy); EU residency; an audit trail.
**Non-goals** — a rules/rates config schema, dual-extractor tables, billing/invoicing tables,
multi-country partitioning (Spain only). Deferred to MVP.

## 4. Storage choices

| Data | Store | Notes |
|---|---|---|
| Relational records | **PostgreSQL** — local via docker-compose ([00 · Dev Infra](00-dev-infra.md)); managed **EU Postgres** (e.g. Supabase / Neon) for the pilot | **Decided** (2026-07). Starter DDL: [`infra/postgres/init.sql`](../../infra/postgres/init.sql). |
| Receipt blobs | **Cloudflare R2, `jurisdiction = "eu"`** | Hard EU residency; key `receipts/{driver_id}/{yyyy}/{mm}/{message_id}-{n}.{ext}`. |
| Audit log | Append-only `metric_event` + row timestamps | Immutable provenance for AEAT + GDPR. |

## 5. Entities (POC-minimal)

| Entity | Key fields | Purpose |
|---|---|---|
| **Carrier** | id · legal_name · NIF/CIF · vat_regime · province · fleet_size · intl_runner(bool) · **gasoleo_censo_status** · status · created_at | The autónomo/micro-carrier business (ICP screen fields, dossier §8). `gasoleo_censo_status` = the trust-hook enrolment ([05](05-onboarding-authorization.md)). |
| **Driver** | id · carrier_id · name · registered_email · **forwarding_address (unique)** · onboarding_stage · created_at | The forwarding identity; often == carrier owner. |
| **Authorization** | id · driver_id · type (`apoderamiento`\|`colaborador_social`) · cert_type (`FNMT`\|`Cl@ve`) · status (`requested`\|`granted`\|`verified`) · evidence_ref · granted_at | The **G2** make-or-break record. |
| **Document** | id · driver_id · r2_key · from · to · message_id · **attachment_index** · subject · mime · size · received_at · **source** (`forwarded`\|`asesor_upload`) · status · **unique(message_id, attachment_index)** | **One attachment = one Document** (emails carry several); dedup on (message_id, attachment_index). `asesor_upload` covers the **historical backlog** (bulk fuel-card invoices). |
| **Extraction** | id · document_id · fields(jsonb) · confidence(jsonb) · model · **corrected_fields(jsonb)** · status · created_at | LLM output + asesor corrections (= **accuracy ground truth**). `fields` jsonb also holds **multi-line-item** fuel-card invoices ([02](02-extraction-agent.md)). |
| **Claim** | id · carrier_id · type (`foreign_vat`\|`excise`\|`dietas`) · **disposition** (`file`\|`assure`\|`identify_only`) · country · period · document_ids[] · **recoverable_eur** · **asesor_minutes** · status (`draft`\|`ready`\|`blocked`\|`filed`) · blocked_reason · created_at | Human-assembled; € entered by the asesor. POC **files** `foreign_vat`; *gasóleo* excise is `assure` (trust hook); foreign excise/*dietas* `identify_only` (upsell). `asesor_minutes` → cost-to-serve. |
| **Filing** | id · claim_id · form (`modelo_360`) · method (`colaboracion_social`) · aeat_reference · submitted_by · submitted_at · status | Records the human filing — **POC files `file`-disposition (foreign-VAT) claims only**; foreign-excise/IRPF forms are MVP. Drives "€ filed". |
| **MetricEvent** | id · type · carrier_id? · driver_id? · document_id? · claim_id? · payload(jsonb) · created_at | Append-only event stream for the gate dashboards ([06](06-instrumentation-metrics.md)). |

## 6. Lifecycle (status machines)

- **Document:** `received → ready_for_review → reviewed → claimed`; **`extraction_failed →
  reviewed`** via manual entry in the console ([04](04-concierge-console.md)) — failed docs
  still reach the asesor, never dropped.
- **Claim:** `draft → ready | blocked → filed` (→ *paid* is tracked out-of-band; POC measures
  **filed, not paid** — dossier §8).

## 7. Interfaces

- Email Worker writes `Document`; extraction writes `Extraction`; console mutates
  `Extraction.corrected_fields`, `Claim`, `Filing`; all emit `MetricEvent`.
- Console reads via SQL views / a REST layer (e.g. PostgREST, or the low-code tool's Postgres connector).

## 8. Non-functional

- **GDPR/residency:** EU region for Postgres + R2 `eu`; row-level security **if it's free with the
  chosen stack** (don't spend days on it for one asesor + ops); a DPA with every processor (DB,
  storage, LLM vendor). **Retention + erasure-with-legal-hold:** on a data-subject request, delete
  blobs + rows for carriers **without filed claims**; for carriers **with filed claims**, retain
  the *filing provenance* under AEAT record-keeping duties (prescription ≥4 yr / colaborador social
  obligations) and delete the rest.
- **Auditability:** append-only events + immutable filing records; never hard-delete filed-claim
  provenance except under the retention policy.
- **Encryption:** at rest by default; evaluate app-layer encryption of PII fields for AEAT-grade data.

## 9. Dependencies & sequencing

First thing built (WK 0–1); everything depends on it.

## 10. Acceptance criteria

- A receipt can be traced end-to-end: `Driver → Document(+R2 blob) → Extraction(+corrections) →
  Claim(+€) → Filing(+AEAT ref)`, all EU-resident, with an event trail per step.
- Authorization state per driver is queryable for the G2 metric.
- A data-subject erasure request removes a carrier's PII **except filing provenance under legal
  hold** (retained per AEAT duties); the retention/legal-hold policy is documented.

## 11. Open questions & risks

1. ~~Postgres vs D1~~ **Decided: PostgreSQL** — local docker; managed EU Postgres for the pilot.
2. App-layer encryption of PII fields — needed for AEAT-grade data, or is at-rest enough?
3. Retention window (how long to keep raw receipts/filings) — align with AEAT + GDPR.
4. Do Carrier and Driver collapse to one record for solo autónomos? (Keep separate; allow 1:1.)

## 12. Out of scope / deferred

Rates/rules config, dual-extractor tables, billing, multi-country schema, per-diem day-counting tables.

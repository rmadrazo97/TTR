# tasks/ — TTR POC build plan

The buildable plan for TTR's **POC (concierge pilot, weeks 0–8)**: a set of scoped
PRDs plus the technology research behind them. This folder is the bridge between
the **research dossier** (`../research/`, the *why* and *what*) and product code
(`../src/`, still an empty scaffold).

> Read [`../AGENTS.md`](../AGENTS.md) and [`../docs/DOSSIER.md`](../docs/DOSSIER.md)
> first. The dossier is the source of truth for the business; these PRDs scope the
> **build** and must stay aligned with the dossier's §6 product plan and §8 Spain
> pilot.

## What the POC has to prove

The POC exists to validate the pilot's four gates — **not** to be a finished
product. Measure **€ recovered, not documents processed.** The recoverable € is mostly a
**historical backlog** (≈12 months of fuel-card invoices) filed against the hard
**30-Sep-2026 *modelo 360* deadline** that falls mid-pilot — so **bulk backlog intake**, not
just live forwarding, is in scope ([00](prd/00-poc-overview.md)).

| Gate | Bar | Owned mostly by |
|---|---|---|
| **G1** Recruit | 25–40 carriers signed · CAC ≈ €0 | GTM / ops |
| **G2** Onboard & authorize *(make-or-break)* | ≥60% grant *apoderamiento* & send first docs | [05-onboarding-authorization](prd/05-onboarding-authorization.md) · [01-email-ingestion](prd/01-email-ingestion.md) |
| **G3** Recover & file | ≥€4k median recovery / int'l truck · ≥90% extraction accuracy | [02-extraction-agent](prd/02-extraction-agent.md) · [04-concierge-console](prd/04-concierge-console.md) |
| **G4** Prove WTP *(willingness to pay)* | ~15% success fee accepted | WTP interviews · [06-instrumentation-metrics](prd/06-instrumentation-metrics.md) |

## Confirmed scope decisions (2026-07)

Set by the product owner before drafting these PRDs:

- **Build boundary — agent does *ingest + extraction only*.** The agent receives
  the email, stores the document, and returns extracted fields + a confidence
  score. **A human *asesor* does reconciliation, validation, the € calculation,
  and files** — in the concierge console. This keeps the POC close to the
  dossier's "build nothing a human + no-code can fake" and defers the automated
  rules/validation engine to the MVP.
- **Ingest — email only, via Cloudflare *Email for Agents*.** One per-driver
  forwarding address. No WhatsApp in the POC.
- **Coverage — software build + a thin onboarding/authorization PRD.** No formal
  GTM/ops PRDs here (those live in the dossier's §5 and §8).

**Stack decisions (2026-07):** **DB = PostgreSQL** (local via [`infra/`](../infra/) docker-compose;
managed EU Postgres for the pilot). **Email inbound = Mailgun-EU / Postmark parse webhook**
(recommended — faster + EU DPA; Cloudflare Email Routing the reversible alt). **Orchestration = a
thin Cloudflare Queue** now; LangGraph/deep-agents deferred to MVP.

## The PRD set

Each PRD follows [`prd/_TEMPLATE.md`](prd/_TEMPLATE.md). Status legend:
`⬜ planned · ✍️ drafting · ✅ ready · 🔬 needs research`.

| # | PRD | Scope in one line | Status |
|---|---|---|---|
| 00 | [POC Overview & Architecture](prd/00-poc-overview.md) | Scope, gate→feature map, end-to-end architecture, stack, sequencing, cross-cutting (GDPR/security) | ✅ |
| 00 | [Development Infrastructure](prd/00-dev-infra.md) | Local `docker compose` stack (Postgres + R2/MinIO + email sink) to run the pipeline offline — real files in [`infra/`](../infra/) | ✅ |
| 01 | [Email Ingestion](prd/01-email-ingestion.md) | Cloudflare Email for Agents → per-driver address → attachment(s) to R2 → Document record | ✅ |
| 02 | [Extraction Pipeline & Orchestration](prd/02-extraction-agent.md) | LLM-vision extraction of the 4 key fields + confidence; **thin Cloudflare-native** now, LangGraph/deep-agents deferred to MVP | ✅ |
| 03 | [Data Model & Persistence](prd/03-data-model.md) | Carrier · Driver · Document · Extraction · Claim · Filing · MetricEvent; Postgres (EU) + R2 (EU); retention | ✅ |
| 04 | [Concierge Console](prd/04-concierge-console.md) | Asesor workspace: review/correct extraction, **manual** reconcile/validate/€, backlog upload, filing tracker, per-driver € statement | ✅ |
| 05 | [Onboarding & Authorization](prd/05-onboarding-authorization.md) | Signup + eligibility screen + *apoderamiento* (AEAT Registro de Apoderamientos, REGAPO) / Certificado Digital capture — the G2 gate | ✅ |
| 06 | [Instrumentation & Pilot Metrics](prd/06-instrumentation-metrics.md) | Event model + dashboard for the G2/G3/G4 gates; measure *filed*, not *paid* | ✅ |

## Research behind the PRDs

Cited technical briefs that inform the stack decisions (see [`research/`](research/)):

| Brief | Informs |
|---|---|
| [01 · Cloudflare Email for Agents](research/01-cloudflare-email-for-agents.md) | PRD 01 (ingestion) |
| [02 · Agent orchestration (LangGraph vs deep agents)](research/02-agent-orchestration.md) | PRD 02 (extraction) |

## How to read this

1. Start with **[00 · Overview](prd/00-poc-overview.md)** — the architecture and
   how the pieces connect.
2. Read the two **research briefs** for the two novel technology bets.
3. Then the feature PRDs 01→06 in build order (see the sequencing table in 00).
4. To run it locally: **[00 · Dev Infra](prd/00-dev-infra.md)** + the real
   [`infra/`](../infra/) stack (`docker compose up`).

*These PRDs are proposals scoped to the POC. The two load-bearing business numbers
(~€6,000 recovered / int'l truck, ~15% fee) are what the POC validates — treat
them as hypotheses, not facts, per the dossier.*

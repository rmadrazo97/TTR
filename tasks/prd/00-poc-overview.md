# PRD 00 · POC Overview & Architecture

> **Status:** ✅ ready · **Phase:** POC (concierge pilot, weeks 0–8) · **Owner:** TBD
> **Related:** dossier [§6 Product](../../research/06-product.html) ·
> [§8 Spain pilot](../../research/08-spain-pilot.html) · [DOSSIER.md](../../docs/DOSSIER.md) ·
> research: [Cloudflare email](../research/01-cloudflare-email-for-agents.md) ·
> [orchestration](../research/02-agent-orchestration.md)

## 1. Summary

The POC is an **8-week concierge pilot** that proves TTR's business, not a finished
product. It gives 25–40 Spanish micro-carriers a way to **forward a foreign fuel/toll
receipt by email**, has an **AI vision pass** extract the key invoice fields, and puts
those in front of a **licensed *asesor* who does the reconciliation, the recoverable-€
calculation, and the *modelo 360* filing by hand**. The goal is to validate the two
load-bearing numbers (≈€6,000 recovered / international truck, ~15% success fee accepted)
and the make-or-break onboarding step (drivers granting filing rights) — while writing
**as little durable code as possible**.

> The POC deliberately **fakes the tax logic with a human** (dossier §6.3). The moat —
> automated reconciliation, invoice-validity, the claim-readiness dashboard — is **MVP
> work**, not POC. Build only what a human + no-code genuinely can't fake at pilot volume.

> **The pilot's money is the *backlog*, not live forwarding.** Hitting G3 (≥€4k median /
> int'l truck by WK 8) is impossible on receipts forwarded as drivers fuel up (~€700/truck
> over the pilot). The recoverable € is **retrospective** — ~12 months of **fuel-card monthly
> invoices** and shoebox receipts, filed against the **hard 30-Sep-2026 *modelo 360* deadline**
> (2025 annual foreign-VAT claim), which falls *inside* the pilot window. So the POC must ingest
> a **historical backlog** (bulk, asesor-assisted), treat **multi-page fuel-card invoices as
> first-class documents**, and let the 30-Sep deadline drive WK 3–8 sequencing. This shapes
> [01](01-email-ingestion.md), [02](02-extraction-agent.md), and [04](04-concierge-console.md).

## 2. Which gates this serves

The pilot (dossier §8) is four gates. The software's job is to make G2 and G3 measurable
and low-friction; G1 and G4 are mostly GTM/ops.

| Gate | Bar | POC software contribution |
|---|---|---|
| **G1** Recruit | 25–40 carriers signed · CAC ≈ €0 | Signup capture ([05](05-onboarding-authorization.md)) |
| **G2** Onboard & authorize *(make-or-break)* | ≥60% grant *apoderamiento* + send first docs | Authorization flow ([05](05-onboarding-authorization.md)) + email ingest proves docs arrive ([01](01-email-ingestion.md)) |
| **G3** Recover & file | ≥€4k median / int'l truck · ≥90% extraction accuracy | Extraction accuracy ([02](02-extraction-agent.md)); € tracked in console ([04](04-concierge-console.md)); measured ([06](06-instrumentation-metrics.md)) |
| **G4** Prove WTP *(willingness to pay)* | ~15% fee accepted | Per-driver recovery statement as the WTP/referral asset ([04](04-concierge-console.md)/[06](06-instrumentation-metrics.md)) |

## 3. Confirmed scope decisions (2026-07)

1. **Build boundary — agent does *ingest + extraction only*.** The automated path stops at
   "fields + confidence." A human asesor does **reconciliation, validation, the € calc, and
   filing** in the console. (No automated rules/validity engine in the POC.)
2. **Ingest — email only, via Cloudflare.** One per-driver forwarding address. No WhatsApp.
3. **Coverage — software build + a thin onboarding/authorization PRD.** GTM and asesor SOP
   stay in the dossier (§5, §8), not here.

## 4. End-to-end architecture

```
 Driver phone ──email (photo/PDF of foreign receipt)──▶  ┌─────────── CLOUDFLARE (EU) ───────────┐
                                                          │  Email Routing (catch-all)            │
                                                          │        │ email() handler              │
                                                          │        ▼                              │
                                                          │  Email Worker                          │
                                                          │   • parse MIME (postal-mime)           │
                                                          │   • map message.to → driver            │
                                                          │   • put attachment → R2 (jurisdiction=eu)
                                                          │   • write Document row  ───────────────┼──▶  Postgres (EU)
                                                          │   • message.reply() "✅ recibido"       │        Carrier · Driver · Document
                                                          │   • hand off ──▶ Queue                 │        Extraction · Claim · Filing · MetricEvent
                                                          │        │                               │              ▲
                                                          │        ▼  consumer (retry + DLQ)       │              │ writes Extraction
                                                          │  Extraction: 1 LLM-vision call ────────┼──────────────┘
                                                          │  → 4 key fields + confidence           │
                                                          └────────────────────────────────────────┘
                                                                            │ asesor picks up flagged/ready docs
                                                                            ▼
                                                   Concierge console (asesor)  ── manual: reconcile · validate ·
                                                   compute recoverable € · assemble claim · file modelo 360 ·
                                                   track € identified & filed per driver
```

*Inbound edge shown as Cloudflare Email Routing; the **recommended** path is a Mailgun-EU /
Postmark parse webhook into the same Worker ([01](01-email-ingestion.md)).*

The automated pipeline ends at **Extraction**. Everything downstream is a **human in a
simple console**. Filing is a human on *colaboración social* / *apoderamiento* (dossier §6.1).

**What the POC actually files vs. tracks** (dossier §8): the POC **files Stream A — foreign
VAT via *modelo 360*** (the money). *Gasóleo profesional* excise is **assured** (the trust
hook — already automated via the fuel card, TTR just confirms census enrolment), and foreign
professional-diesel excise + *dietas* are **identified and recorded** as upsell value, **not
filed** by TTR in the POC. The per-driver statement shows all three so the WTP conversation is
honest ([04](04-concierge-console.md)).

## 5. Recommended stack

Right-sized to a 2–4 person team and ~60–120 trucks. Provider-agnostic where it matters.

> **Supersedes the dossier's §6.1 POC stack** (WhatsApp/Twilio · Postmark/Mailgun · Make/Zapier ·
> "only custom code: two webhooks") per the 2026-07 scope decisions above. The dossier's §6.1
> should eventually be updated so the "source of truth" doesn't re-open this.

| Layer | Choice | Why / notes |
|---|---|---|
| **Email ingest** | **Mailgun-EU / Postmark inbound parse webhook** → Cloudflare Worker *(recommended — faster + EU DPA)*; Cloudflare Email Routing the single-platform alt | Webhook = no MIME parsing, sender-auth verdicts included, EU residency solved ([01](01-email-ingestion.md)). |
| **Document store** | Cloudflare **R2**, `jurisdiction = "eu"` | Hard EU residency guarantee for the receipt blobs. |
| **Extraction** | **1 LLM-vision call** off a plain **Cloudflare Queue** consumer — *no agent framework* | Fetch image → 1 call → write row. A Cloudflare *Workflow* (`waitForEvent`) is the MVP seam; LangGraph/deep-agents deferred to MVP ([02](02-extraction-agent.md)). |
| **LLM vision** | Provider-agnostic (e.g. Claude vision) under an **EU-processing DPA** | Bias to lowest-hallucination — a wrong VAT number kills a claim. |
| **Canonical DB** | **PostgreSQL** — local via docker-compose ([00 · Dev Infra](00-dev-infra.md)); managed **EU Postgres** (e.g. Supabase / Neon) for the pilot | **Decided** (2026-07). |
| **Concierge console** | Low-code admin (e.g. Retool/Appsmith/Supabase Studio) on the Postgres, or a thin custom app | "Simple admin console / CRM" (dossier). Fast to stand up; the asesor's workspace ([04](04-concierge-console.md)). |
| **Filing** | **Human asesor** — *modelo 360* via colaboración social / apoderamiento | No web-service e-filing in the POC (Platform work). |
| **Billing** | **None in POC** | Fee is validated by WTP interviews (G4), not charged. Stripe is MVP. |

## 6. Cross-cutting concerns

- **GDPR / EU residency (highest-priority risk).** Receipts are tax PII filed with AEAT.
  R2 `eu` and the EU Postgres region give resident *storage*; the **inbound Cloudflare Email
  Routing layer has no documented EU-only processing region** and the LLM-vision vendor
  processes document images — both need a **signed DPA + written residency answer before
  real carrier data flows** (see [01 §6](../research/01-cloudflare-email-for-agents.md)).
  **Recommended inbound = Mailgun-EU / Postmark parse webhook**, which ships EU residency + a DPA
  out of the box (and is faster to build). Cloudflare Email Routing stays a reversible alt; if
  chosen, get Cloudflare's written residency answer + DPA by **end of WK 0** or fall back to the
  webhook. [01](01-email-ingestion.md) isolates the receive layer so the choice is a shim, not a
  rewrite. Consent + retention/deletion policy and an audit log are in scope from day one.
- **Security.** Least-privilege service credentials; secrets in the platform vault; the
  per-driver address is treated as a shared secret (the Worker can't read SPF/DKIM/DMARC
  verdicts — see [01 §3](../research/01-cloudflare-email-for-agents.md)); asesor auth on the console.
- **Auditability.** Every document keeps provenance (raw `Message-ID`, `From`, R2 key,
  timestamps); every asesor correction and filing is logged — AEAT-grade record-keeping and
  the ground truth for the ≥90% accuracy metric.

## 7. Build sequencing

Aligns to the pilot timeline (dossier §8): recruit WK1–2, onboard/authorize WK2–4, recover
& file WK3–8.

| When | Build | PRDs |
|---|---|---|
| WK 0 | **Dev infra up** (`docker compose`): Postgres + R2/MinIO + email sink | [00 · Dev Infra](00-dev-infra.md) |
| WK 0–1 | Data model + managed Postgres + R2(eu) + onboarding/auth capture | [03](03-data-model.md), [05](05-onboarding-authorization.md) |
| WK 1–2 | Email ingestion (get real docs flowing) — unblocks G2 | [01](01-email-ingestion.md) |
| WK 2–3 | Extraction agent + wire accuracy metric | [02](02-extraction-agent.md), [06](06-instrumentation-metrics.md) |
| WK 2–4 | Concierge console (asesor reconcile/validate/€/file) | [04](04-concierge-console.md) |
| WK 3–8 | Backlog recovery + instrumentation dashboards + per-driver statements; iterate | [04](04-concierge-console.md), [06](06-instrumentation-metrics.md) |

> **Hard deadline inside the pilot:** the 2025 annual *modelo 360* is due **30 Sep 2026** —
> mid-pilot. Sequence WK 3–8 to file each carrier's foreign-VAT **backlog** before it; the
> console's filing tracker ([04](04-concierge-console.md)) counts down to it.

## 8. Non-goals (POC) — deferred to MVP/Platform

Automated rules/validity engine · automated recoverable-€ calculation · dual-extractor
reconcile · VIES automation · web-service e-filing (modelo 360 API) · Stripe billing ·
driver-facing PWA/self-serve · WhatsApp ingest · native apps · multi-country (Spain only) ·
LangGraph/deep-agents orchestration (migration path in [02](02-extraction-agent.md)) ·
per-diem/*dietas* automation.

## 9. Key open questions

1. ~~Canonical DB~~ **Decided: PostgreSQL** — local via docker-compose, managed EU Postgres for
   the pilot. → [03](03-data-model.md) · [00 · Dev Infra](00-dev-infra.md)
2. **Email provider — recommended: Mailgun-EU / Postmark inbound webhook** (faster to build +
   clears the inbound-residency blocker); confirm EU region + DPA by WK 0. Cloudflare Email
   Routing is the reversible single-platform alt. → [01](01-email-ingestion.md)
3. **LLM-vision vendor + EU DPA + accuracy** on messy multilingual fuel/toll invoices. → [02](02-extraction-agent.md)
4. **Console build-vs-buy:** low-code admin vs thin custom app for the asesor. → [04](04-concierge-console.md)

## 10. Risks (POC-specific; cross-market risks live in dossier §7)

- **G2 is the true gate.** If certificate/apoderamiento friction blocks non-digital-native
  drivers, nothing downstream matters — over-invest in onboarding UX ([05](05-onboarding-authorization.md)).
- **Extraction accuracy on real photos** may miss ≥90% on the 4 fields; the console must make
  correction fast and must *measure* accuracy from corrections ([02](02-extraction-agent.md)/[06](06-instrumentation-metrics.md)).
- **The two load-bearing numbers are hypotheses.** The POC exists to test them — don't build
  as if they're proven.

# PRD 04 · Concierge Console

> **Status:** ✅ ready · **Phase:** POC · **Owner:** TBD
> **Related:** [00 · Overview](00-poc-overview.md) · [02 · Extraction](02-extraction-agent.md) ·
> [03 · Data model](03-data-model.md) · [06 · Metrics](06-instrumentation-metrics.md)

## 1. Summary

The asesor's workspace — a **simple admin console / CRM** where the human does everything the
POC intentionally doesn't automate: **review and correct** the AI extraction, **manually
reconcile and validate** each invoice, **compute the recoverable €**, **assemble the claim**,
record the **modelo 360 filing**, and produce the **per-driver recovery statement**. This is
where the tax logic is "faked with a human" (dossier §6.3), and where most of the POC's real
work happens.

## 2. Which gates this serves

**G3** (€ recovered per truck + extraction accuracy via corrections) and **G4** (the recovery
statement is the WTP/referral asset). Also surfaces the **G2** doc-flow.

## 3. Goals / Non-goals

**Goals** — a fast review→correct→validate→claim→file loop for one asesor; capture corrections
as accuracy ground truth; track € identified & filed per driver/truck; be buildable in days.
**Non-goals** — automated validation/€/rules (the human does these), driver-facing views,
Stripe billing, e-filing integration, multi-user workflow/roles beyond asesor + ops.

## 4. Users & context

One contracted **asesor fiscal** (colaborador social) + TTR ops. Spanish-language UI. Works a
queue on their own schedule; needs the receipt image and fields side by side.

## 5. Functional requirements

1. **Auth** — asesor/ops login (Supabase auth or the low-code tool's auth).
2. **Review queue** — `Document`s `ready_for_review` **and `extraction_failed`**, sorted by
   lowest confidence first; failed docs open a **blank manual-entry form** (so they still reach
   the asesor — never dropped). Shows the R2 image next to the extracted 4 fields + confidence
   colour-coding.
3. **Correct & confirm** — edit any field; the diff is saved to `Extraction.corrected_fields`
   (accuracy ground truth) and the document marked `reviewed`. One-click "looks right".
4. **Manual reconcile & validate** — record a validity verdict + notes per document: supplier
   VAT-ID check (a **VIES link**, opened manually — *not* automated), gross = net + VAT sanity,
   date within the claim window, category eligible. Blocked items get a reason.
5. **Assemble claim** — group validated documents into a `Claim` (`foreign_vat` / `excise`);
   **enter the recoverable €** (manual, with a convenience sum of VAT amounts shown); set
   `ready` or `blocked (+reason)`.
6. **Record filing** — after the asesor files *modelo 360* on AEAT, capture form, method
   (colaboración social), **AEAT reference**, date → `Claim.filed`, create `Filing`. The tracker
   surfaces the **30-Sep-2026 *modelo 360* deadline** countdown per carrier (dossier §8).
7. **Per-driver recovery statement** — shows **gasóleo €X assured** (trust hook), **foreign VAT
   €Y filed** (the money), and **excise/*dietas* €Z identified** (upsell) — plus € identified vs €
   **filed** per driver/truck; printable/exportable — the referral + WTP asset (G4).
8. **Gate snapshot** — **a link** to the metrics dashboard ([06](06-instrumentation-metrics.md))
   (don't duplicate its tiles here).
9. **Backlog bulk upload** — the asesor can upload a carrier's **historical fuel-card monthly
   invoices / receipts** (multi-file drag-drop) → `Document`s with source=`asesor_upload` → the
   same extraction queue. This is how the pilot recovers ~12 months of € before 30-Sep (dossier
   §8), not one email at a time.
10. **Cost-to-serve capture** — record **asesor minutes per claim** (a simple field) so
    [06](06-instrumentation-metrics.md) can compute cost-to-serve — half the unit-economics case
    (dossier §8, WK 6–8).
11. Every action emits a `MetricEvent`.

## 6. Approach / architecture

**Build-vs-buy:** recommend a **low-code admin** (Retool / Appsmith / Supabase Studio) directly
on the Postgres for speed — this *is* the dossier's "simple admin console / CRM," and it keeps
the POC's custom-code surface small. Only drop to a thin custom app (Next.js on Supabase) if the
image-vs-fields review UX genuinely can't be built in the low-code tool — **hold this line**,
since a custom app is where the POC's "no custom backend" discipline quietly dies. Either way it
reads/writes [PRD 03](03-data-model.md) and displays R2 images via signed URLs.

## 7. Data & schema touched

Reads `Document`, `Extraction`, `Driver`, `Carrier`; **creates `Document`s (source=`asesor_upload`
backlog)**; writes `Extraction.corrected_fields`, `Claim` (incl. `asesor_minutes`), `Filing`,
`MetricEvent`.

## 8. Interfaces & contracts

Postgres (auto-REST / SQL) + R2 signed URLs for images. No external filing API in the POC.

## 9. Non-functional

- **GDPR:** access limited to the asesor/ops; images via short-lived signed URLs; all viewing/
  editing audited.
- **Speed:** the review loop must be fast enough to process a pilot's volume by hand.
- **Spanish-language**, low-friction for a single power user.

## 10. Dependencies & sequencing

Needs [03](03-data-model.md) and [02](02-extraction-agent.md) output. Build WK 2–4; iterate WK 3–8.

## 11. Acceptance criteria

- An asesor can take a `ready_for_review` document → correct fields → validate → add to a claim
  with a € value → mark filed with an AEAT reference — in one place.
- Corrections are captured such that extraction accuracy is computable ([06](06-instrumentation-metrics.md)).
- A per-driver recovery statement can be generated for any pilot carrier.

## 12. Open questions & risks

1. Low-code admin vs thin custom app — which hits the review UX bar fastest? (Recommend low-code.)
2. How much €-calc help to give (pure manual vs VAT-sum helper) without drifting into building
   the rules engine we're deferring.
3. Statement format that best supports the WTP conversation (design with GTM).

## 13. Out of scope / deferred

Automated validation/VIES/€ engine, driver-facing portal, Stripe, e-filing API, multi-role
workflow, analytics beyond the gate tiles.

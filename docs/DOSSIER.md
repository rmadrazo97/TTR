# TTR Research Dossier — context & key facts

The dossier (`research/`) is the source of truth for TTR's strategy. This file
summarizes its substance so agents can work without re-reading every page. See
[`../AGENTS.md`](../AGENTS.md) for editing conventions and voice rules.

## One-line thesis

Incumbents (fuel-card majors + reclaim agents) serve fleets via account managers
and card lock-in; the owner-operator's local *gestor* files the domestic books but
never chases the cross-border reclaim. **Nobody turns the 1–10-truck operator's
receipts into recovered tax.** TTR wins with self-serve AI ingestion,
no-win-no-fee pricing, and a bundle no one else offers: fuel VAT + diesel excise +
per-diem relief in one place. The closest look-alikes (Pleo/Yokoy/Rydoo) are
horizontal spend tools — **domain depth is the moat, not the UI.**

## What we recover — three streams

| Stream | What | ~€ / int'l truck / yr | Notes |
|---|---|---|---|
| **A · Cross-border VAT** | VAT on diesel, tolls, AdBlue, repairs bought abroad; reclaimed via the home portal (Dir. 2008/9/EC; ES *modelo 360*) | ~€4,800 (fuel ~4,000 + toll ~800) | Hard 30-Sep deadline. Min claim €400 part-year / €50 full-year (Art. 17). CJEU *Vega Int'l* fuel-card-invoice risk. |
| **B · Professional-diesel excise** | Partial national excise refund, trucks ≥7.5t (FR *gazole professionnel*, ES *gasóleo profesional*, IT, BE…) | ~€1,200 blended (up to €5,446 all-France) | Rates volatile & country-specific → live config. Shrinking pool (EU Energy Taxation Directive recast risk). |
| **C · Per-diem / dietas** | Driver days/nights income-tax relief | driver-level upsell | Declining (EU Mobility Package). Thin for the Spanish *autónomo*; really a payroll product for carriers that *employ* drivers. |

**≈ €6,000 recoverable per international truck / year** (Streams A + B = the core
business; Stream C is an upsell).

## Market sizing

- **TAM** €10.8B recoverable / €1.6B fee (≈1.8M international-active EU trucks × €6,000 × 15%). *The truck count is load-bearing and unverified — cross-check via Eurostat.*
- **SAM** €5.5B recoverable / €825M fee (SME / owner-operator segment).
- **SOM** ~€190M processed / ~€28M fee (realistic 3-yr capture, ~35k trucks).
- **Spain slice (est. ~8% of each layer)** ~€0.85B recoverable / ~€130M fee; ~145k international trucks of ~360k total.
- **Honesty caveat:** recoverable ≠ unclaimed — much is already recovered (card net-invoicing, agents, self-filing). The honest near-term prize is the smaller *unclaimed* pool.

## Unit economics (illustrative)

Revenue **€900** / int'l truck / yr (€6,000 × 15%) − cost-to-serve **~€120–180**
(automated pipeline + light human QA) − CAC **~€120–200** → contribution
**~€520–660** (yr 1). Revenue is seasonal & lagged (VAT pays 4–8 months after the
30-Sep filing); measure **€ filed**, not paid.

## Spain — the first market

- **ICP:** an international-running *autónomo* / micro-carrier (1–10 heavy trucks ≥7.5t) in **Murcia / the Mediterranean corridor / Aragón**, holding a fuel card + Certificado Digital, using a generalist gestor, leaving foreign VAT & excise unclaimed.
- **The correction that shapes the pilot:** *gasóleo profesional* (domestic excise) is **already automated** via fuel cards → it's the **trust hook, not the money**. The money is the manual, abandoned **foreign VAT + excise**.
- **Filing authorization:** *apoderamiento electrónico* (AEAT Registro de Apoderamientos) or *colaborador social* status + the driver's Certificado Digital (FNMT, free) / Cl@ve. AEAT accepts electronic submission via **file upload** (*presentación mediante fichero*) or **web services** (SOAP, certificate-authenticated; preproduction sandbox). The certificate/apoderamiento onboarding is the **make-or-break UX**.
- **Pilot scale:** 25–40 carriers (~60–120 trucks) → €360–720k recovered, ~€55–110k fee.

### The gated 8-week pilot (page 8 is a single timeline)

| Stage | Gate · KPI |
|---|---|
| WK 1–2 · Recruit (Fenadismer + FB) | **G1** — 25–40 carriers signed · CAC ≈ €0 |
| WK 2–4 · Onboard & authorize | **G2** — ≥60% grant apoderamiento & send docs *(make-or-break)* |
| WK 3–8 · Recover & file (concierge asesor) | **G3** — ≥€4k median recovery/truck · ≥90% extraction accuracy |
| WK 6–8 · Prove & decide | **G4** — ~15% fee accepted (validated WTP) |
| WK 8 · Go/no-go | GO → build the MVP; else fix onboarding first (G2 is the true gate) |

## Competition & white space

Fuel-card majors (DKV, UTA, Eurowag, AS24), reclaim specialists (FastVAT, Vialtis,
Négométal), enterprise VAT-tech (VAT4U, Fintua, VAT IT, Blue Dot), generic spend
tools (Pleo, Yokoy, Rydoo). The nearest look-alikes are **horizontal, not
carrier-vertical** — none does cross-border fuel-VAT reclaim, HGV excise, fuel-card
invoice handling, or per-country carrier rules. **White space = card-agnostic,
self-serve, micro-priced, bundling all three recoveries.** In Spain: Andamur
(Murcia fuel card — watch), brokers (Enlazo), gestorías (FROET/CETM). No AI-native
Spanish startup owns the niche.

## Product direction (page 6)

Mobile-first; **multimodal AI extraction (OCR + vision LLMs, provider-agnostic)** +
a per-country **rules engine** → a validated, filing-ready claim.

- **POC · concierge** (weeks 0–8) — email/WhatsApp ingest → LLM extraction → a
  simple admin console; a human asesor verifies & files. No custom backend.
- **MVP** (months 2–5) — self-serve PWA + the foreign-VAT / *modelo 360* flow,
  dual-extractor reconcile + confidence, claim-readiness dashboard, Stripe
  success-fee billing.
- **Platform** (months 6–18) — native apps, fuel-card/TMS + tachograph ingest,
  multi-country rules engine, **automated AEAT e-filing** + apoderamiento
  management at scale, white-label API.

*OCR is a commodity; **reconciliation, invoice-validity, and the claim-readiness
dashboard are the product.***

## Key risks (see page 7 risk board)

High: unit economics soft · pre-financing = a working-capital/credit business ·
clawback & representative liability · fraud magnet. Medium: eligibility floors,
data access, extraction accuracy, per-diem legislated down, licensing per country,
fuel-card VAT recharacterisation, gestor loyalty. The moat is **execution +
accumulation** (community trust → apoderamientos + claim-history data → widen
coverage faster than a card major cannibalises its own margin).

## Dossier page map

`index.html` + `01`–`08` + `09-glossary.html`, sharing `assets/styles.css`. See the
table in [`../README.md`](../README.md).

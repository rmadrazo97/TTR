# PRD 05 · Onboarding & Authorization (thin)

> **Status:** ✅ ready · **Phase:** POC · **Owner:** TBD
> **Related:** [00 · Overview](00-poc-overview.md) · [01 · Email ingestion](01-email-ingestion.md) ·
> [03 · Data model](03-data-model.md) · dossier
> [§8 pilot](../../research/08-spain-pilot.html) · [§6.1 filing/authorization](../../research/06-product.html)

## 1. Summary

The concierge-assisted flow that turns a recruited carrier into one that can actually file:
capture the carrier/driver, **screen eligibility**, assign the forwarding address, and — the
hard part — **capture that the driver has granted TTR the right to file** (*apoderamiento* via
AEAT's REGAPO, or *colaborador social* status) with a verified **Certificado Digital / Cl@ve**.
Thin on software (forms + status + evidence capture); heavy on hand-holding. **This is the
make-or-break gate.**

## 2. Which gate this serves

**G1** (signup capture) and above all **G2 — ≥60% grant *apoderamiento* & send first docs.**
If authorization friction blocks non-digital-native drivers, the pilot stops here; the dossier
calls this the true gate. Software's job: make the funnel *measurable* and remove every avoidable
step, not to replace the human onboarder.

## 3. Goals / Non-goals

**Goals** — capture ICP-screen data; provision the forwarding address; guide + **record**
apoderamiento/certificate status with evidence; capture GDPR consent + the no-win-no-fee
engagement; make the onboarding funnel measurable.
**Non-goals** — automating the AEAT apoderamiento grant (that's an MVP product surface),
self-serve signup, a full e-signature platform, KYC/AML tooling.

## 4. Users & context

**Driver/owner:** non-digital-native, Spanish, avg age >50 (dossier §8) — trust and simplicity
beat slick UX; onboarding is **in-person/video**, hand-held. **TTR ops** runs the session;
**asesor** holds colaborador social status.

## 5. Functional requirements

1. **Signup capture** — Carrier + Driver record ([03](03-data-model.md)): legal name, NIF/CIF,
   province (prioritise Murcia / Med corridor / Aragón), fleet size, international-runner flag.
2. **Eligibility screen** (dossier §8): *estimación directa* VAT regime · ≥7.5t + Euro class
   (Italy needs Euro 5+) · holds a fuel card + Certificado Digital · runs international · **not
   already net-invoiced** · **censo de *gasóleo profesional* enrolment status** — the **trust
   hook** (dossier §8): capture whether the carrier is enrolled so the asesor can *assure* it,
   even though it isn't the money. Record pass/fail + reasons; ineligible → parked, not deleted.
3. **Assign forwarding address** — create the unique address ([01](01-email-ingestion.md)) and
   help the driver save it as a phone contact; send a test-forward instruction.
4. **Authorization capture (the core)** — guide the driver to grant **apoderamiento** in AEAT's
   *Registro de Apoderamientos* (or enrol TTR's asesor as **colaborador social**), and verify a
   working **Certificado Digital (FNMT, free) / Cl@ve**. The software **records status**
   (`requested → granted → verified`), the certificate type, and evidence — it does **not** drive
   AEAT. Show the driver a simple step-by-step (screens/checklist) in Spanish.
5. **Consent & engagement** — capture GDPR consent (data processing, retention) and the
   no-win-no-fee terms; store with the Carrier.
6. **Funnel tracking** — per-driver onboarding_stage feeds the G2 metric: % of onboarded who
   **both** granted apoderamiento **and** sent ≥1 doc.
7. **Nudges (manual).** Drivers who granted apoderamiento but **haven't sent docs**, or stalled
   mid-onboarding, are flagged on the status board for a **manual TTR-ops follow-up** (call/
   message) — the software reminds *ops*, ops reminds the driver. "Granted-but-no-docs" is a
   direct G2 lever.

## 6. Approach / architecture

Deliberately low-tech: a small set of **forms + a status board** on the same low-code stack as
the console ([04](04-concierge-console.md)), writing `Carrier`/`Driver`/`Authorization`
([03](03-data-model.md)). Evidence (screenshots/PDFs of the granted apoderamiento) stored in
R2(`eu`). No AEAT integration in the POC.

## 7. Data & schema touched

Writes `Carrier`, `Driver`, `Authorization`, consent fields; emits `MetricEvent`
(`carrier_signed`, `authorization_granted`, `first_doc_received`).

## 8. Interfaces & contracts

Manual/at-AEAT for the grant itself; TTR captures the outcome. Forwarding-address creation is a
shared contract with [01](01-email-ingestion.md).

## 9. Non-functional

- **GDPR:** consent captured before processing; certificate credentials are **never** stored by
  TTR — only the *fact* and evidence of the grant; evidence in EU storage.
- **Accessibility:** Spanish, phone-first instructions, minimal jargon.
- **Trust:** the human onboarder is the product here; the software just records and reminds.

## 10. Dependencies & sequencing

Built first alongside [03](03-data-model.md) (WK 0–1); enables [01](01-email-ingestion.md) (addresses)
and the G2 measurement in [06](06-instrumentation-metrics.md). Runs live WK 2–4.

## 11. Acceptance criteria

- A recruited carrier can be screened, recorded, given a forwarding address, and have their
  apoderamiento/certificate status captured with evidence — in one session.
- The G2 number (% granted **and** sent a doc) is computable at any time.
- No certificate secrets are stored; consent + engagement are on file.

## 12. Open questions & risks

1. **Apoderamiento vs colaborador social** — which is the primary path for the pilot, and does
   the asesor's colaborador social status cover filing without per-driver apoderamiento? (Legal.)
2. **Certificate friction** — what's the real drop-off getting FNMT/Cl@ve working on drivers'
   phones? This *is* the G2 risk — design the assist around it.
3. **Evidence standard** — what proof of grant do we keep for audit without storing credentials?
4. **e-signature** — is a lightweight consent capture enough, or do we need a formal tool?

## 13. Out of scope / deferred

Automated apoderamiento API/flow, self-serve onboarding, KYC/AML, e-signature platform,
multi-country authorization.

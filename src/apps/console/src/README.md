# @ttr/console — the concierge console

The asesor's server-rendered admin (PRD [04](../../../tasks/prd/04-concierge-console.md),
[05](../../../tasks/prd/05-onboarding-authorization.md),
[06](../../../tasks/prd/06-instrumentation-metrics.md)). This is where the tax logic the POC
intentionally doesn't automate is "faked with a human": review & correct the AI extraction,
manually reconcile/validate each invoice, compute the recoverable €, assemble the claim, record
the *modelo 360* filing, and produce the per-driver recovery statement.

Deliberately minimal: **Hono + `hono/jsx` server-side rendering** — HTML tables + POST forms,
functional over polished. Spanish-language UI for one power user (the asesor). It reads/writes
**only** through `@ttr/core` (repos, storage, metrics); it owns no schema of its own.

## Run

```bash
# from the monorepo root (src/)
npm -w @ttr/console run start      # tsx src/server.ts, listens on :3000
npm -w @ttr/console run dev        # watch mode
```

Shared-password **Basic-Auth** (POC only) gates everything except `/healthz`:

```
CONSOLE_USER=asesor            # default
CONSOLE_PASSWORD=ttr_dev_pw    # default — change in any shared env
```

DB / object-store config comes from `@ttr/core`'s `loadConfig()` (the `infra/.env` keys:
`DATABASE_URL`, `S3_*`, `R2_BUCKET`, …). Receipt images are shown via short-lived R2 signed URLs.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Gate dashboard — G2 (% granted apoderamiento AND sent ≥1 doc), G3 (extraction accuracy from `corrected_fields` diffs; median € recovered/truck from filed claims), G4 (WTP), + a 30-Sep-2026 *modelo 360* countdown; includes a WTP-interview capture form |
| POST | `/wtp` | Log a carrier's fee-acceptance interview → `metrics.emit('wtp_response')` (the G4 source) |
| GET | `/queue` | Review queue: `documents.listForReview()` (`ready_for_review` + `extraction_failed`), lowest confidence first; failed docs open a blank manual-entry form |
| GET | `/documents/:id` | Side-by-side review: R2 image + editable 4-field form + manual reconcile/validate block (VIES link, gross=net+VAT, date-in-window — human-entered, **not** automated) + add-to-claim |
| POST | `/documents/:id/correct` | `extractions.setCorrected` + `documents.setStatus('reviewed')` + `metrics.emit('field_corrected')` |
| POST | `/documents/:id/validate` | Records the human validity verdict + checks + notes as a `document_validated` metric event |
| POST | `/documents/:id/add-to-claim` | Appends the doc to a claim's `document_ids`, marks it `claimed` |
| GET/POST | `/claims`, `/claims/:id` | Assemble a `Claim` (type, disposition `file`\|`assure`\|`identify_only`, docs, `recoverable_eur`, `asesor_minutes`), status `ready`\|`blocked(+reason)`; a convenience VAT-sum is shown but the € stays manual |
| POST | `/claims/:id/file` | Record the filing (form `modelo_360`, method `colaboracion_social`, AEAT reference) → claim `filed` + `filings.create` + `metrics.emit('claim_filed')` |
| GET | `/statements/:driverId` | Per-driver recovery statement: gasóleo € **assured** (trust hook) + foreign-VAT € **filed** (the money) + excise/dietas € **identified** (upsell); € identified vs filed. Printable |
| GET/POST | `/upload` | Backlog bulk upload (multi-file) → `documents.insert` source `asesor_upload`, status `received` → the same extraction queue |
| GET/POST | `/onboarding` | Capture Carrier/Driver + eligibility (incl. `gasoleo_censo_status`) + Authorization status; a manual nudge list for **granted-but-no-docs** |
| GET | `/healthz` | Unauthed liveness probe |

## Metric events emitted

`carrier_signed`, `authorization_granted`, `first_doc_received` (on the first backlog upload for a
driver), `field_corrected`, `document_validated`, `document_added_to_claim`, `claim_created`,
`claim_ready`, `claim_blocked`, `claim_filed`, `wtp_response`. These feed the PRD 06 gate dashboard.

## Layout

```
src/
  server.ts        entry — @hono/node-server on :3000
  app.tsx          Hono wiring: GET pages + POST actions, Basic-Auth
  auth.ts          shared-password Basic-Auth middleware (POC)
  layout.tsx       shared HTML shell + small presentational components
  fmt.ts           pure format/parse helpers (eur, pct, parseMoney, …)
  metrics.ts       G2/G3/G4 gate computations (read-only SQL via @ttr/core)
  statements.ts    per-driver recovery-statement aggregation
  onboarding.ts    onboarding status-board reads + granted-but-no-docs nudge list
  pages/*.tsx      one SSR component per screen
  actions/*.ts     POST handlers (all writes via @ttr/core repos)
  __tests__/*      vitest — pure helpers + route-handler smoke tests
```

## Design notes (holding the POC line)

- **No rules engine.** Validity, VIES, and € are **human** decisions. The validate block records
  what the asesor did; it doesn't decide. The claim's `recoverable_eur` is typed in by hand (a VAT
  sum is shown only as a convenience). This is deliberate (PRD 04 §5.4, §12).
- **€ filed, not € paid.** The dashboard and statement report € *filed*; cash lands months later,
  after the POC ends (PRD 06 §9).
- **Accuracy = corrections, not confidence.** G3 accuracy compares `Extraction.fields` vs
  `corrected_fields` across the 4 scored fields (`vatId`/`date`/`gross`/`vat`) with a defensible
  normalisation (see `metrics.ts` `normaliseField`) — not self-reported confidence.
- **GDPR.** Certificate credentials are never stored — only the *fact* + an evidence ref. Images
  are short-lived signed URLs. Access is behind the shared credential.

## Tests

```bash
npm -w @ttr/console test          # vitest (or: npm test at the root)
```

Covers the pure helpers (`fmt`, `metrics` scoring), that each GET page returns 200 (Basic-Auth
enforced), and that a correction POST persists `corrected_fields` + flips the document to
`reviewed`. Tests mock `@ttr/core`, so they run without a live DB/S3.

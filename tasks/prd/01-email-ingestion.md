# PRD 01 · Email Ingestion

> **Status:** ✅ ready · **Phase:** POC · **Owner:** TBD
> **Related:** [00 · Overview](00-poc-overview.md) · [03 · Data model](03-data-model.md) ·
> [02 · Extraction](02-extraction-agent.md) · research:
> [Cloudflare Email for Agents brief](../research/01-cloudflare-email-for-agents.md)

## 1. Summary

The single ingestion surface for the POC: each driver gets a **unique forwarding email
address**; when they forward a photo/PDF of a foreign fuel/toll/AdBlue receipt, an **inbound
handler** parses it, stores the attachment in **EU-resident R2**, records a `Document`, sends a
bilingual "✅ received" acknowledgement, and hands the document to the extraction step. The
**recommended** inbound path is a **Mailgun-EU / Postmark parse webhook** (faster + EU DPA);
Cloudflare Email Routing is the single-platform alternative (§6).

## 2. Which gate this serves

**G2 (make-or-break):** proves drivers actually *send documents* after onboarding. The count
of drivers who send ≥1 doc is half the G2 bar. Fast, reliable ingest + an instant ack builds
the trust that keeps non-digital-native drivers sending.

## 3. Goals / Non-goals

**Goals**
- Receive email to a per-driver address; associate it to the right `Driver`.
- Extract attachments; store originals in EU-resident object storage with full provenance.
- Acknowledge receipt to the driver within seconds.
- Hand each document to extraction without blocking the mail handler.
- Be honest about the GDPR + sender-trust caveats and mitigate them.

**Non-goals (deferred)**
- WhatsApp / any non-email channel · driver-facing upload UI · the Agents SDK / conversational
  reply routing · outbound email beyond a simple ack · in-handler extraction (belongs in [02](02-extraction-agent.md)).

## 4. Users & context

The forwarder is a **non-digital-native Spanish micro-carrier driver/owner** (dossier §8: avg
age >50). They save one contact and forward receipts from their phone mail app. Fragile
formatting (plus-tags, multi-page phone PDFs) must degrade gracefully with Spanish-language
guidance.

## 5. Functional requirements

*Requirements are the same for both inbound paths; they're written for the Cloudflare Email
Routing mechanism. Under the **recommended webhook path**, the provider does the routing + MIME
parsing (FR1, FR3) and the Worker reads the JSON payload — see §6.*

1. **Domain + routing.** Verify an ingest domain (e.g. `ingest.ttr.example`) in Cloudflare
   Email Routing; a **catch-all** rule routes every address to the Worker (avoids the
   200-rule/domain ceiling).
2. **Per-driver address.** Each driver gets a memorable **full address** (e.g.
   `juan.perez@ingest.ttr.example`) saved as a phone contact. The Worker resolves
   `message.to` against a driver-address table. *(Sub-addressing `receipts+DRVID@…` is the
   fallback; some clients mangle `+`-tags — see research §3.)*
3. **Parse.** Read `message.raw` with `postal-mime` → subject, body, `attachments[]`.
4. **Attachment validation.** Allowlist `image/jpeg`, `image/png`, `application/pdf`; reject
   others and empty-attachment mails with a helpful Spanish reply/bounce; guard the **25 MiB
   whole-message limit** (base64 inflates ~33%). **Multi-page fuel-card PDF invoices are
   first-class** — they carry most of the recoverable € (dossier §8); only nudge "send fewer per
   email" when loose phone photos would blow the limit. Bulk **historical backlog** comes through
   the asesor's console upload ([04](04-concierge-console.md)), not email.
5. **Store.** `put()` **each attachment** to **R2 (`jurisdiction = "eu"`)** under
   `receipts/{driver_id}/{yyyy}/{mm}/{message_id}-{attachment_index}.{ext}`; keep original
   filename in object metadata.
6. **Record + idempotency.** Write **one `Document` per attachment** (driver_id, r2_key, from,
   to, message_id, attachment_index, subject, received_at, size, mime, source=`forwarded`).
   **Dedupe on `(message_id, attachment_index)`** (drivers resend). *(Emails routinely carry
   several receipts — never collapse them to one row; see [03](03-data-model.md).)*
7. **Sender trust.** Primary key = `message.to` (the secret per-driver address). **Cross-check
   `From`** against the driver's registered email; on mismatch (or first email from a new
   `From`), flag for a **manual ops confirmation (a call/message from TTR ops — not an automated
   identity flow)** rather than silently trusting — the Worker **cannot read SPF/DKIM/DMARC
   verdicts** (workerd #6740).
8. **Acknowledge.** `message.reply()` with a short bilingual confirmation ("✅ Recibido — lo
   estamos procesando / Received"). Handle the reply constraints (valid DMARC, single reply,
   recipient == original sender).
9. **Hand off.** Enqueue the `Document` id to the extraction Workflow/Queue and return fast.
   Never run the LLM in the mail handler.
10. **Unknown address.** Bounce or reply "this address isn't registered — contact TTR" and log it.
11. **Rejected / unreadable follow-up.** When a document is rejected here (bad type, oversize) or
    later comes back illegible from extraction ([02](02-extraction-agent.md)), **TTR ops** sends a
    manual Spanish "please resend" — assigned to a human, not automated (concierge, dossier §8).

## 6. Approach / architecture

**Provider decision (recommended): a Mailgun-EU / Postmark inbound *parse* webhook.** The provider
receives the mail, parses MIME, and POSTs a **single JSON** (attachments pre-decoded + sender-auth
verdicts) to a **Cloudflare Worker** HTTP route; the Worker validates, writes blobs to **R2
(`jurisdiction=eu`)**, records `Document`s in **Postgres**, enqueues extraction, and sends the ack.
**Faster to build** (no MIME parsing, auth verdicts included) and it **clears the inbound-residency
blocker** (Mailgun EU region + DPA). It's also the easiest to develop locally — POST a fixture JSON
at the worker ([00 · Dev Infra](00-dev-infra.md)).

**Alternative (single-platform): Cloudflare Email Routing** — a plain `email()` Worker +
`postal-mime`; free unlimited inbound, but you parse MIME yourself, **can't read auth verdicts**
(workerd #6740), and must resolve Cloudflare's inbound-residency answer by WK 0.

**Either way:** compute is a Cloudflare Worker, storage is R2(`eu`), the DB is Postgres. **Isolate
`parse → store → record → handoff` behind plain functions** so the receiving edge (webhook vs.
`email()`) is a thin, swappable shim — not a rewrite. Total custom code ≈ a 150–250-line handler +
driver resolver + attachment validation.

## 7. Data & schema touched

Writes `Document` (+ dedupe index on `message_id`); reads `Driver` / driver-address map.
Canonical shapes in [PRD 03](03-data-model.md).

## 8. Interfaces & contracts

- **Inbound:** SMTP → Email Routing → `email()` handler.
- **Outbound:** `message.reply()` ack (verify it avoids the paid Sending tier).
- **Downstream:** `{document_id}` enqueued to the extraction Workflow/Queue ([02](02-extraction-agent.md)).

## 9. Non-functional

- **GDPR:** the **recommended Mailgun-EU / Postmark webhook** ships EU residency + a DPA out of the
  box, clearing the inbound-residency question. If instead using **Cloudflare Email Routing** (no
  documented EU-only inbound region), obtain Cloudflare's written answer + DPA by **end of WK 0** or
  fall back to the webhook. R2 `eu` guarantees resident storage; CLOUD Act exposure persists for any
  US-parent processor.
- **Provenance/retention:** persist raw `Message-ID`, `From`, R2 key, timestamps; define a
  retention/deletion window with the asesor's record-keeping needs.
- **Cost:** ~$0–5/month at pilot volume (inbound free).
- **Latency:** ack within a few seconds; extraction is async.

## 10. Dependencies & sequencing

Needs [03](03-data-model.md) (`Document`, driver-address map) and the ingest domain live.
Unblocks [02](02-extraction-agent.md). Build WK 1–2.

## 11. Acceptance criteria

- A driver forwards a receipt → within seconds: attachment in R2(`eu`), a `Document` row with
  full provenance, and an ack in the driver's inbox.
- Resent identical email does **not** create a duplicate `Document` (Message-ID dedupe).
- Unknown/mismatched sender is flagged (not silently trusted); oversized/non-allowlisted mail
  gets graceful Spanish guidance.
- No LLM/extraction work runs inside the mail handler.

## 12. Open questions & risks

1. **Inbound provider** — recommended **Mailgun-EU / Postmark webhook** (residency + DPA solved);
   confirm EU region + webhook signature verification. Cloudflare Email Routing only if
   single-platform is worth the WK-0 residency chase.
2. **Sender trust** — is "secret address + From cross-check + first-use confirmation" enough
   anti-fraud for tax docs, or do we need a per-driver token?
3. **Outbound** — is `message.reply()`-only sufficient, or do we need the beta Email Sending
   (unpublished ramp-up quota) / Resend / Postmark for reliability?
4. **Addressing** — full per-driver address vs `+`-subaddressing; validate against drivers'
   actual mail clients.
5. **25 MiB reality** — multi-page phone PDFs may exceed it; define the compression/split policy.
6. **R2 at-rest keys** — CF-managed AES-256 vs app-layer encryption for AEAT-grade PII.

## 13. Out of scope / deferred

Agents SDK, HMAC reply routing, `routeAgentEmail`, conversational threads, WhatsApp, outbound
correspondence with AEAT, driver upload UI.

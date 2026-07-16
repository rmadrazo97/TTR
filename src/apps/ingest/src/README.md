# `@ttr/ingest` — inbound email ingestion (PRD 01)

The single ingestion surface for the TTR POC. A driver forwards a photo/PDF of a foreign
fuel/toll/AdBlue receipt to their **secret per-driver address**; the mail provider
(Mailgun-EU / Postmark) parses the MIME and POSTs a **normalized JSON** to this app, which:

1. **verifies** the provider signature (constant-time; 401 on failure),
2. **resolves** the driver by the `To:` address (the routing key),
3. for **each** attachment: MIME-allowlists (jpg/png/pdf) + 25 MiB-guards, stores the blob
   in EU-resident **R2/S3**, and records **one `Document`** (deduped on
   `message_id + attachment_index`),
4. **emits metrics** (`first_doc_received` once per driver + a per-doc event),
5. **cross-checks** the `From:` against the driver's registered email and flags mismatches
   for a manual ops call,
6. sends a **bilingual "✅ Recibido / Received" ack**, and
7. **returns fast** — extraction is polled later by the worker (`status='received'`).
   **No LLM/extraction ever runs here** (PRD 01 FR9).

A Hono app: portable Node now (`@hono/node-server` on **:8787**), a Cloudflare Worker
later (same `app`, swap the edge adapter). It imports **only** from `@ttr/core`.

## Layout

```
apps/ingest/
├─ package.json               name "@ttr/ingest"; deps @ttr/core, hono, @hono/node-server
├─ tsconfig.json              references packages/core
└─ src/
   ├─ server.ts               @hono/node-server on :8787 (INGEST_PORT overrides)
   ├─ app.ts                  Hono routes + defaultDeps() wiring @ttr/core
   ├─ handlers/
   │  ├─ inbound.ts           handleInbound() — transport-agnostic FR1–11 logic
   │  └─ health.ts            liveness body
   ├─ webhook.ts              normalizeInbound() + verifySignature() — the swappable seam
   ├─ attachments.ts          MIME allowlist + 25 MiB guard + object-key builder
   ├─ messages.ts             bilingual ack / nudge bodies
   ├─ types.ts                InboundEmail (provider-neutral internal shape)
   └─ __tests__/              vitest units (mock @ttr/core; no DB/S3/SMTP)
```

## Endpoints

### `GET /health`

Cheap liveness probe (no backing-service I/O).

```json
{ "status": "ok", "service": "@ttr/ingest", "time": "2026-07-16T09:24:00.000Z" }
```

### `POST /inbound`  (`application/json`)

The inbound parse-webhook. **Request** (task-normalized camelCase contract):

```json
{
  "provider": "mailgun_eu",
  "sender": "juan.perez@example.com",
  "recipient": "juan.perez@ingest.ttr.example",
  "subject": "factura",
  "messageId": "<abc@mail>",
  "signature": "<hmac-sha256-hex>",
  "spf": "pass", "dkim": "pass", "dmarc": "pass",
  "attachments": [
    { "filename": "receipt.jpg", "contentType": "image/jpeg", "contentBase64": "..." }
  ]
}
```

The handler **also accepts the repo's snake_case fixture shape** (`from`/`to`/`message_id`/
`content_type`/`content_base64` with a Mailgun-style `timestamp`) — see *Signature seam*
below — so `fixtures/receipt.webhook.json` drives the app unchanged.

**Responses:**

| Status | When | Body |
|---|---|---|
| `200` | Accepted (some/all attachments may be rejected individually) | `{ ok, driverId, stored[], rejected[], senderTrust }` |
| `400` | Body isn't JSON, or missing `recipient`/`messageId` | `{ error }` |
| `401` | Signature verification failed | `{ error }` |
| `422` | `recipient` isn't a registered driver address (a Spanish/EN nudge is also emailed) | `{ error, recipient }` |

`200` body detail:

```json
{
  "ok": true,
  "driverId": "drv-1",
  "stored": [
    { "documentId": "doc-1", "attachmentIndex": 0,
      "r2Key": "receipts/drv-1/2026/07/abc@mail-0.jpg", "deduped": false }
  ],
  "rejected": [
    { "attachmentIndex": 1, "filename": "big.pdf", "reason": "oversize" }
  ],
  "senderTrust": "match"
}
```

- `deduped: true` ⇒ the `(message_id, attachment_index)` row already existed (a resend);
  no new blob/metric is double-counted.
- `rejected[].reason` ∈ `bad_mime | empty | oversize`.
- `senderTrust` ∈ `match | mismatch | unknown` (mismatch/unknown also emit
  `ingest_sender_flagged` for a manual ops confirmation — never silent trust; FR7).

## Signature seam (`webhook.ts`)

Verification lives behind **one function** so the receiving edge is swappable (PRD 01 §6).
Real Mailgun/Postmark use their own header sets + canonicalization; this POC supports two
synthetic-but-normalized HMAC-SHA256 (hex, keyed by `INBOUND_WEBHOOK_SECRET`) schemes,
auto-selected by payload shape:

1. **Task contract** (no `timestamp`): `signature === HMAC(secret, recipient + messageId)`.
2. **Repo fixture** (`timestamp` present): `signature === HMAC(secret,` `` `${timestamp}.${compactBody}` `` `)`
   where `compactBody` is `JSON.stringify(payload)` with `timestamp` + `signature` removed
   (documented in `fixtures/README.md`).

Both use `crypto.timingSafeEqual` (constant-time). Swapping in a provider's real scheme is
a change to this one file.

## Run

```sh
# from src/ — backing services + seed first (see src/README.md)
docker compose -f ../infra/docker-compose.yml up -d
npm run seed

# start the ingest app (from src/apps/ingest, or via workspace):
npm start                                # tsx src/server.ts → http://localhost:8787

# drive it with the committed fixture:
curl -X POST localhost:8787/inbound \
  -H 'content-type: application/json' \
  --data @../../fixtures/receipt.webhook.json
# → Document (Adminer :8080) · blob (MinIO :9001) · ack (Mailpit :8025)
```

## Test

```sh
npm test        # vitest units — mock @ttr/core; no DB/S3/SMTP required
```

Covered: valid multi-attachment insert, dedupe, unknown recipient, bad MIME, oversize, bad
signature, sender-trust flagging, both signature schemes, the committed fixture, and the
Hono route status mapping.

## Notes / caveats

- **Store-then-record order:** the blob is `putObject`'d before the `Document` insert so a
  row never points at a missing object.
- **`first_doc_received`** fires once per driver (snapshotted via a pre-insert count); a
  resend is deduped, so it never re-fires. Best-effort — the dashboard (PRD 06) also counts
  distinct drivers.
- **Multi-page fuel-card PDFs are first-class** (they carry most recoverable €); the only
  size nudge is for loose phone photos that would blow the 25 MiB whole-message limit.
- **Metrics/ack are best-effort:** a metrics or SMTP failure never fails ingestion (the
  `Document` + blob are the durable record).
- **GDPR:** blobs go to R2 `jurisdiction=eu`; the provider (Mailgun-EU/Postmark) supplies
  EU-resident inbound + a DPA (PRD 01 §9).

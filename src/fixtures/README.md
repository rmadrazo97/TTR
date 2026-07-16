# fixtures/ — local pipeline test inputs

SYNTHETIC data only. These drive the ingest → extract → review loop offline.

## `receipt.webhook.json`

A sample **inbound email parse webhook** (Mailgun-EU / Postmark style, normalized to
the fields PRD 01 needs). POST it at the local ingest worker:

```sh
curl -X POST localhost:8787/inbound \
  -H 'content-type: application/json' \
  --data @fixtures/receipt.webhook.json
```

Expected result: a `Document` row (driver = `juan.perez`, resolved from `to`), a blob in
MinIO under `receipts/{driver_id}/2026/07/...png`, an ack in Mailpit, and — after the
extraction worker runs — an `Extraction` row.

### Payload shape

| Field | Meaning |
|---|---|
| `timestamp` | Unix seconds; part of the signed string (replay guard). |
| `signature` | HMAC-SHA256 hex over `` `${timestamp}.${compactJsonBody}` `` (see below). |
| `message_id` | Raw `Message-ID`; the dedup key with `attachment_index`. |
| `from` / `to` | `to` is the per-driver forwarding address (the routing key). |
| `subject`, `received_at`, `text` | Provenance / body. |
| `attachments[]` | `{ filename, content_type, content_base64 }` — one Document each. |

The single attachment is a **1×1 transparent PNG** (70 bytes) — a valid `image/png` so
storage + the mock extractor run without a real photo. The mock extractor keys its
deterministic output off the **filename** (`receipt-fr-001.png`), so this fixture always
yields the same fields/confidence.

### How the signature was computed

`signature` verifies the webhook came from the provider using the shared
`INBOUND_WEBHOOK_SECRET` (fixture value: **`changeme`**, the `.env.example` default).

**Signed string** = `` `${timestamp}.${body}` `` where `body` is the compact JSON of the
payload **with the `timestamp` and `signature` keys removed** and the remaining keys in
the order shown in the file (`message_id, from, to, subject, received_at, text,
attachments`). Compact = `JSON.stringify(obj)` (no whitespace).

```js
import crypto from 'node:crypto';
const { timestamp, signature, ...body } = payload;   // strip the two envelope keys
const signed = `${timestamp}.${JSON.stringify(body)}`;
const expected = crypto.createHmac('sha256', process.env.INBOUND_WEBHOOK_SECRET)
  .update(signed).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
```

For this fixture (`secret = "changeme"`):

- `timestamp = 1784107440` (= `2026-07-15T09:24:00.000Z`)
- `signature = 0efd20d97d46620415e03c8d05a9dc86d48656cad85bd5c3285662940138506f`

Regenerate after editing the body: recompute with the snippet above and paste the new
`signature`. (Real Mailgun/Postmark use their own header + canonicalization; the ingest
worker keeps verification behind one function so swapping the provider scheme is a
localized change — PRD 01 §6.)

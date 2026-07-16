# PRD 00 · Development Infrastructure (local docker-compose)

> **Status:** ✅ ready · **Phase:** POC · **Owner:** TBD
> **Related:** [00 · Overview](00-poc-overview.md) · [01 · Email](01-email-ingestion.md) ·
> [02 · Extraction](02-extraction-agent.md) · [03 · Data model](03-data-model.md) ·
> files: [`../../infra/`](../../infra/)

## 1. Summary

A **one-command local environment** (`docker compose up`) that stands up the POC's stateful
backing services — Postgres, an S3-compatible object store, an email sink — so a developer (or an
AI coding agent) can run the whole **ingest → extract → review** pipeline **offline against
synthetic data**, with no cloud account needed to iterate. **Production stays serverless**
(Cloudflare Workers/Queues + R2 + managed Postgres); compose mirrors those services with local
stand-ins so code written locally deploys unchanged.

## 2. Which gate this serves

None directly — it's the substrate that lets [01](01-email-ingestion.md)–[06](06-instrumentation-metrics.md)
be built and tested fast. **Build this first (WK 0).**

## 3. Goals / Non-goals

**Goals** — reproducible local dev; parity with the prod backing services; schema + seed + email
fixtures loaded automatically; runnable by an agent from the [`infra/` README](../../infra/) alone.
**Non-goals** — production deploy / IaC (that's Wrangler config + a managed Postgres), Kubernetes,
CI/CD, secrets management, and **any real carrier PII** (synthetic data only).

## 4. Production ↔ local mapping

| Concern | Production | Local (docker-compose) |
|---|---|---|
| **DB** | Managed **EU Postgres** (e.g. Supabase / Neon) | **`postgres:16`** container (`init.sql` = the [PRD 03](03-data-model.md) schema) |
| **Blob store** | **Cloudflare R2** (`jurisdiction=eu`, S3 API) | **`minio`** (S3-compatible) + a `receipts` bucket |
| **Email inbound** | **Mailgun-EU / Postmark** parse webhook → Worker *(recommended)*; or Cloudflare Email Routing | `curl` a sample webhook JSON at the local worker; **`mailpit`** shows outbound acks |
| **Compute** (ingest + extraction) | Cloudflare **Workers + Queues** | **`wrangler dev`** (Miniflare) on the host, pointed at the compose services |
| **Console** | Low-code admin (Appsmith self-host / Retool) | **`appsmith`** container *(optional `--profile console`)* |
| **DB browser** | — | **`adminer`** *(optional `--profile tools`)* |
| **LLM vision** | Provider API (e.g. Claude), EU DPA | real API key, or `EXTRACTION_MOCK=true` deterministic stub |

*Only the orchestration glue is Cloudflare-specific; everything stateful has a faithful local
twin, so R2↔MinIO and Postgres↔Postgres are drop-in via env vars.*

## 5. Services

| Service | Image | Purpose | Port(s) |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | Canonical DB; runs `init.sql` on first boot | 5432 |
| `minio` | `minio/minio` | R2 stand-in (S3 API) | 9000 (API) · 9001 (console) |
| `createbuckets` | `minio/mc` | One-shot: creates the `ttr-receipts-eu` bucket | — |
| `mailpit` | `axllent/mailpit` | SMTP sink + web UI for outbound acks | 1025 (SMTP) · 8025 (UI) |
| `adminer` | `adminer` | DB browser *(profile `tools`)* | 8080 |
| `appsmith` | `appsmith/appsmith-ce` | Self-hosted asesor console ([04](04-concierge-console.md)) *(profile `console`, heavy ~2 GB)* | 8090 |

The full, runnable compose is [`infra/docker-compose.yml`](../../infra/docker-compose.yml); the
schema is [`infra/postgres/init.sql`](../../infra/postgres/init.sql); config is
[`infra/.env.example`](../../infra/.env.example).

## 6. Config & secrets

`infra/.env` (copy from `.env.example`): `DATABASE_URL`, S3 endpoint/keys (MinIO), `R2_BUCKET`,
email provider + `INBOUND_WEBHOOK_SECRET`, SMTP (Mailpit), `LLM_API_KEY`, `EXTRACTION_MOCK`.
**Never commit real secrets**; local runs on synthetic data with a mock extractor by default.

## 7. Schema & seed

- **Schema:** `init.sql` applies the [PRD 03](03-data-model.md) DDL (8 tables incl. the reviewed
  fixes — `document.unique(message_id, attachment_index)`, `claim.disposition`, `asesor_minutes`,
  `carrier.gasoleo_censo_status`).
- **Seed:** 1–2 sample carriers/drivers (with forwarding addresses) + receipt fixtures (a
  fuel-card PDF and a phone photo, plus a sample Mailgun/Postmark webhook JSON) to drive the
  pipeline end-to-end. `make seed` (or a `seed.sql`).

## 8. Dev workflow

```
cp infra/.env.example infra/.env
docker compose -f infra/docker-compose.yml up -d          # + --profile tools/console if wanted
wrangler dev                                              # the ingest + extraction workers
curl -X POST localhost:8787/inbound -d @fixtures/receipt.webhook.json
# → Document row (Adminer) · blob (MinIO console) · ack (Mailpit) · Extraction row after the queue runs
```

## 9. Non-functional

Synthetic data only (GDPR — no real PII locally); **pinned image tags**; healthchecks +
`depends_on` so boot order is deterministic; named volumes for persistence; heavy/optional
services behind compose **profiles** to keep the default footprint small.

## 10. Acceptance criteria

- `docker compose up` (default profile) yields healthy `postgres` + `minio` (+ bucket) + `mailpit`.
- With `wrangler dev` running, posting a fixture webhook produces a `Document` + a stored blob + an
  `Extraction` row — the full local loop — with the console able to read them.
- A new dev/agent can reproduce all of the above from `infra/README.md` alone.

## 11. Open questions & risks

1. **Wrangler on host vs. a `node` container** — host is simplest for Miniflare; containerizing adds
   fidelity but friction. (Default: host.)
2. **Local queue** — Miniflare Queues (if worker-based) vs. a Redis container. (Default: Miniflare.)
3. **Appsmith by default?** — heavy; keep it behind `--profile console`.
4. **Mock vs. real LLM** — ship a deterministic mock extractor so the pipeline runs with no API key.

## 12. Out of scope / deferred

Production deploy/IaC, Cloudflare account/Wrangler prod config, Kubernetes, CI/CD, multi-arch
images, secrets vaulting.

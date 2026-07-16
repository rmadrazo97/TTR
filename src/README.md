# TTR POC — application code (`src/`)

The TypeScript monorepo behind the TTR concierge pilot: a driver forwards a foreign
fuel/toll receipt by email → it's stored in EU-resident object storage → an AI-vision
pass (mocked offline) extracts the key invoice fields → a human *asesor* reviews,
reconciles, and files. See [`tasks/prd/00-poc-overview.md`](../tasks/prd/00-poc-overview.md)
for the product context and [`tasks/prd/03-data-model.md`](../tasks/prd/03-data-model.md)
for the schema. **SYNTHETIC data only.**

## Layout

```
src/
├─ package.json            workspaces: packages/*, apps/*
├─ tsconfig.base.json      strict ESM (NodeNext, ES2022)
├─ vitest.config.ts        unit tests across packages
├─ packages/
│  └─ core/                @ttr/core — the ONLY dependency the apps import
├─ apps/                   ingest (8787), extraction worker, console (3000) — owned by other agents
├─ scripts/
│  └─ seed.ts              idempotent synthetic carriers + drivers
└─ fixtures/               sample inbound webhook (+ HMAC) and receipt image
```

Everything talks to the local backing services stood up by
[`infra/docker-compose.yml`](../infra/docker-compose.yml): **Postgres** (canonical DB),
**MinIO** (R2 stand-in), **Mailpit** (SMTP sink). Production swaps these for managed EU
Postgres, Cloudflare R2 (`jurisdiction=eu`), and a provider SMTP — via env vars only, so
code written locally deploys unchanged.

## `@ttr/core` — the shared contract

Apps import **only** from `@ttr/core`. It exposes:

- **config** — `loadConfig()` reads the `infra/.env` keys into a typed object.
- **db** — `getPool()`, `query()`, `withTx()` (plain `pg`, no ORM).
- **types** — row types matching `init.sql` exactly + `ExtractionFields` / `Confidence`.
- **repos** — `carriers`, `drivers`, `authorizations`, `documents`, `extractions`,
  `claims`, `filings`, `metrics` (namespaced plain-SQL functions).
- **storage** — `putObject()`, `getSignedUrl()` (S3 v3 SDK → MinIO / R2).
- **email** — `sendAck()` (nodemailer → Mailpit / provider SMTP).
- **extractor** — `makeExtractor(cfg)` → a deterministic `MockExtractor` (default POC
  path, no network) or a guarded provider-agnostic `LlmVisionExtractor`.

## Environment

Copy `infra/.env.example` → `infra/.env` (loaded automatically by `@ttr/core`). Keys:

| Key | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` / `R2_BUCKET` | Object store (MinIO locally, R2 in prod). |
| `SMTP_HOST` / `SMTP_PORT` | Outbound ack (Mailpit locally). |
| `INBOUND_WEBHOOK_SECRET` | Verify the inbound email webhook signature. |
| `LLM_API_KEY` | Vision model key (blank when using the mock). |
| `EXTRACTION_MOCK` | `true` (default) = deterministic offline extractor. |
| `MAIL_PROVIDER` | `mailgun_eu` \| `postmark` \| `cloudflare`. |
| `INGEST_DOMAIN` | Per-driver forwarding domain (default `ingest.ttr.example`). |

## Run order

```sh
# 0. one-time install (a single install for the whole workspace)
npm install                                             # from src/

# 1. backing services (Postgres + MinIO + Mailpit)
docker compose -f ../infra/docker-compose.yml up -d     # + --profile tools for Adminer

# 2. seed synthetic carriers + drivers (idempotent)
npm run seed

# 3. ingest worker  (app agent) — HTTP :8787, POST /inbound
#    4. extraction worker (app agent) — drains 'received' documents
#    5. console (app agent) — asesor review UI :3000

# drive the pipeline with the fixture:
curl -X POST localhost:8787/inbound \
  -H 'content-type: application/json' \
  --data @fixtures/receipt.webhook.json
# → Document (Adminer :8080) · blob (MinIO :9001) · ack (Mailpit :8025) · Extraction after the worker runs
```

Ports: **ingest = 8787**, **console = 3000**. Apps 3–5 live under `apps/` and are built
by other agents; they depend on `@ttr/core` and the schema in `infra/postgres/init.sql`.

## Develop

```sh
npm run typecheck     # tsc -b across the workspace
npm run test          # vitest unit tests (core: extractor, config, repo SQL)
```

Tests are pure-unit; anything touching Postgres/S3/SMTP is exercised by running the live
pipeline against the compose services, not by vitest.

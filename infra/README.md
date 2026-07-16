# infra/ — TTR POC local development stack

A one-command local environment for the POC pipeline. **Spec:**
[`tasks/prd/00-dev-infra.md`](../tasks/prd/00-dev-infra.md). Production runtime is serverless
(Cloudflare Workers/Queues + R2 + managed EU Postgres) — this stack is **local stand-ins only**,
for **synthetic data**.

## Quick start

```sh
cd infra
cp .env.example .env
docker compose up -d                       # postgres + minio (+ bucket) + mailpit
# optional extras:
docker compose --profile tools up -d       # + adminer (DB browser :8080)
docker compose --profile console up -d     # + appsmith (asesor console :8090, heavy)
```

Then run the Cloudflare workers (ingest + extraction) with `wrangler dev` on the host, pointed at
these services via `.env`.

## What's running

| Service | URL | Login |
|---|---|---|
| Postgres | `localhost:5432` | `ttr` / `ttr_dev_pw` (db `ttr`) |
| MinIO API (R2 stand-in) | `localhost:9000` | `ttr_minio` / `ttr_minio_dev_pw` |
| MinIO console | http://localhost:9001 | same |
| Mailpit (email sink) | http://localhost:8025 | — |
| Adminer (`tools` profile) | http://localhost:8080 | Postgres creds above |
| Appsmith (`console` profile) | http://localhost:8090 | set on first run |

The `postgres` container applies [`postgres/init.sql`](postgres/init.sql) (the
[PRD 03](../tasks/prd/03-data-model.md) schema) on first boot; `createbuckets` makes the
`ttr-receipts-eu` bucket in MinIO.

## Prod ↔ local

| Prod | Local |
|---|---|
| Cloudflare R2 (`jurisdiction=eu`) | MinIO (S3 API) — same `S3_*` env keys |
| Managed EU Postgres | `postgres:16` container |
| Mailgun-EU / Postmark parse webhook | `curl` a sample webhook JSON at the worker; Mailpit shows acks |
| Cloudflare Workers + Queues | `wrangler dev` (Miniflare) |

## Notes

- **Synthetic data only** — never load real carrier PII locally (GDPR).
- `EXTRACTION_MOCK=true` (default) runs the pipeline with a deterministic stub, so no LLM key is
  needed offline.
- Reset everything: `docker compose down -v` (drops volumes).

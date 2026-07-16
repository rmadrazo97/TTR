/**
 * Config loading. Reads the env keys defined in `infra/.env.example` and returns a
 * typed, validated config object. `dotenv` loads `infra/.env` (or a project `.env`)
 * on first call so scripts and apps get the same values a running container would.
 */
import { config as loadDotenv } from 'dotenv';

let dotenvLoaded = false;

/** Load .env files once (idempotent). Non-fatal if none exist (real env may be set). */
function ensureDotenv(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  // Prefer an explicit path, then the infra/.env used by docker-compose, then cwd/.env.
  const candidates = [
    process.env.TTR_ENV_FILE,
    new URL('../../../../infra/.env', import.meta.url).pathname,
    '.env',
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  for (const path of candidates) {
    loadDotenv({ path, override: false });
  }
}

export interface S3Config {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
  bucket: string;
  /** MinIO / R2 need path-style addressing. */
  forcePathStyle: true;
}

export interface SmtpConfig {
  host: string;
  port: number;
}

export interface Config {
  databaseUrl: string;
  s3: S3Config;
  smtp: SmtpConfig;
  llmApiKey: string;
  /** When true, the extractor is a deterministic offline mock (no network). */
  extractionMock: boolean;
  /** Shared secret used to verify inbound webhook signatures. */
  webhookSecret: string;
  /** Ingest domain for per-driver forwarding addresses, e.g. 'ingest.ttr.example'. */
  ingestDomain: string;
}

function req(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`[@ttr/core config] missing required env var: ${name}`);
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v.toLowerCase() === 'yes';
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`[@ttr/core config] ${name} is not an integer: ${v}`);
  return n;
}

/**
 * Load and validate config from the environment (loading infra/.env if present).
 * Throws with a clear message if a required key is missing.
 */
export function loadConfig(): Config {
  ensureDotenv();
  return {
    databaseUrl: req('DATABASE_URL', 'postgres://ttr:ttr_dev_pw@localhost:5432/ttr'),
    s3: {
      endpoint: req('S3_ENDPOINT', 'http://localhost:9000'),
      accessKey: req('S3_ACCESS_KEY', 'ttr_minio'),
      secretKey: req('S3_SECRET_KEY', 'ttr_minio_dev_pw'),
      region: req('S3_REGION', 'eu'),
      bucket: req('R2_BUCKET', 'ttr-receipts-eu'),
      forcePathStyle: true,
    },
    smtp: {
      host: req('SMTP_HOST', 'localhost'),
      port: int('SMTP_PORT', 1025),
    },
    llmApiKey: process.env.LLM_API_KEY ?? '',
    extractionMock: bool('EXTRACTION_MOCK', true),
    webhookSecret: req('INBOUND_WEBHOOK_SECRET', 'changeme'),
    ingestDomain: req('INGEST_DOMAIN', 'ingest.ttr.example'),
  };
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

const KEYS = [
  'DATABASE_URL',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_REGION',
  'R2_BUCKET',
  'INBOUND_WEBHOOK_SECRET',
  'SMTP_HOST',
  'SMTP_PORT',
  'LLM_API_KEY',
  'EXTRACTION_MOCK',
  'INGEST_DOMAIN',
];

describe('loadConfig', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('maps env vars into the typed shape', () => {
    process.env.DATABASE_URL = 'postgres://u:p@db:5432/ttr';
    process.env.S3_ENDPOINT = 'http://minio:9000';
    process.env.S3_ACCESS_KEY = 'ak';
    process.env.S3_SECRET_KEY = 'sk';
    process.env.S3_REGION = 'eu';
    process.env.R2_BUCKET = 'ttr-receipts-eu';
    process.env.SMTP_HOST = 'mailpit';
    process.env.SMTP_PORT = '1025';
    process.env.INBOUND_WEBHOOK_SECRET = 'shh';
    process.env.LLM_API_KEY = 'sk-llm';
    process.env.EXTRACTION_MOCK = 'true';
    process.env.INGEST_DOMAIN = 'ingest.ttr.example';

    const cfg = loadConfig();
    expect(cfg.databaseUrl).toBe('postgres://u:p@db:5432/ttr');
    expect(cfg.s3).toEqual({
      endpoint: 'http://minio:9000',
      accessKey: 'ak',
      secretKey: 'sk',
      region: 'eu',
      bucket: 'ttr-receipts-eu',
      forcePathStyle: true,
    });
    expect(cfg.smtp).toEqual({ host: 'mailpit', port: 1025 });
    expect(cfg.llmApiKey).toBe('sk-llm');
    expect(cfg.extractionMock).toBe(true);
    expect(cfg.webhookSecret).toBe('shh');
    expect(cfg.ingestDomain).toBe('ingest.ttr.example');
  });

  it('parses EXTRACTION_MOCK=false as boolean false', () => {
    process.env.EXTRACTION_MOCK = 'false';
    expect(loadConfig().extractionMock).toBe(false);
  });

  it('defaults EXTRACTION_MOCK to true when unset', () => {
    delete process.env.EXTRACTION_MOCK;
    expect(loadConfig().extractionMock).toBe(true);
  });

  it('forcePathStyle is always true (MinIO/R2)', () => {
    expect(loadConfig().s3.forcePathStyle).toBe(true);
  });
});

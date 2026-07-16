/**
 * @ttr/core — the single dependency for all TTR POC apps.
 *
 * Apps (ingest worker, extraction worker, concierge console) import ONLY from
 * "@ttr/core". This barrel re-exports config, db, types, repos, storage, email, and
 * the extractor seam. Column/table names throughout mirror `infra/postgres/init.sql`.
 */

// --- config ---
export { loadConfig } from './config.js';
export type { Config, S3Config, SmtpConfig } from './config.js';

// --- db ---
export { getPool, closePool, query, withTx } from './db.js';
export type { Queryable, PoolClient } from './db.js';

// --- types (rows + value types) ---
export type {
  // rows
  Carrier,
  Driver,
  Authorization,
  Document,
  Extraction,
  Claim,
  Filing,
  MetricEvent,
  // value types
  ExtractionFields,
  Confidence,
  // enums
  AuthorizationType,
  CertType,
  AuthorizationStatus,
  DocumentSource,
  DocumentStatus,
  ExtractionStatus,
  ClaimType,
  ClaimDisposition,
  ClaimStatus,
} from './types.js';

// --- repos ---
export {
  carriers,
  drivers,
  authorizations,
  documents,
  extractions,
  claims,
  filings,
  metrics,
} from './repos/index.js';
export type {
  CarrierInput,
  DriverInput,
  AuthorizationInput,
  DocumentInput,
  ExtractionInput,
  ClaimInput,
  ClaimPatch,
  FilingInput,
  MetricRefs,
} from './repos/index.js';

// --- storage ---
export { putObject, getSignedUrl } from './storage.js';

// --- email ---
export { sendAck } from './email.js';
export type { AckOptions } from './email.js';

// --- extractor ---
export {
  MockExtractor,
  LlmVisionExtractor,
  makeExtractor,
} from './extractor.js';
export type { Extractor, ExtractInput, ExtractResult } from './extractor.js';

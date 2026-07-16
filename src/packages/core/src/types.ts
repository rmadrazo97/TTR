/**
 * Row + value types for the TTR POC.
 *
 * Every row type mirrors a table in `infra/postgres/init.sql` — column names are the
 * EXACT snake_case names from the DDL (that file is the source of truth). String-union
 * types mirror the DB `CHECK` constraints so the compiler catches invalid enum values.
 */

// ---------------------------------------------------------------------------
// Enums — mirror the CHECK constraints in init.sql
// ---------------------------------------------------------------------------

/** `authorization_grant.type` */
export type AuthorizationType = 'apoderamiento' | 'colaborador_social';
/** `authorization_grant.cert_type` — note DB stores 'Clave' (not 'Cl@ve'). */
export type CertType = 'FNMT' | 'Clave';
/** `authorization_grant.status` */
export type AuthorizationStatus = 'requested' | 'granted' | 'verified';

/** `document.source` */
export type DocumentSource = 'forwarded' | 'asesor_upload';
/** `document.status` */
export type DocumentStatus =
  | 'received'
  | 'processing' // claimed by a worker (atomic claim); prevents double-processing
  | 'ready_for_review'
  | 'reviewed'
  | 'claimed'
  | 'extraction_failed';

/** `extraction.status` — free-text in DDL; POC uses this small set. */
export type ExtractionStatus = 'ready_for_review' | 'extraction_failed' | 'reviewed';

/** `claim.type` */
export type ClaimType = 'foreign_vat' | 'excise' | 'dietas';
/** `claim.disposition` */
export type ClaimDisposition = 'file' | 'assure' | 'identify_only';
/** `claim.status` */
export type ClaimStatus = 'draft' | 'ready' | 'blocked' | 'filed';

// ---------------------------------------------------------------------------
// Value types (stored as jsonb)
// ---------------------------------------------------------------------------

/**
 * The extraction contract (PRD 02 §4). The 4 accuracy-scored fields are
 * vatId/date/gross/vat; the rest is context for the asesor. `lineItems` carries
 * multi-page fuel-card monthly invoices (each entry uses the same shape).
 *
 * Stored in `extraction.fields` (and `extraction.corrected_fields`) as jsonb.
 */
export interface ExtractionFields {
  /** Supplier VAT ID — the claim-killer if wrong. */
  vatId?: string;
  /** Invoice/receipt date, ISO-8601 (YYYY-MM-DD) when parseable. */
  date?: string;
  /** Gross amount, total incl. VAT. */
  gross?: number;
  /** VAT amount — the reclaim base. */
  vat?: number;
  /** ISO-4217 currency code, e.g. 'EUR'. */
  currency?: string;
  /** ISO-3166 alpha-2 country of supply, e.g. 'FR'. */
  country?: string;
  /** Supplier / merchant name. */
  supplier?: string;
  /** fuel | toll | adblue | other. */
  category?: string;
  /** Litres dispensed, when present on a fuel receipt. */
  litres?: number;
  /** Per-line breakdown for multi-page fuel-card monthly invoices. */
  lineItems?: ExtractionFields[];
}

/**
 * Calibrated confidence for an extraction (PRD 02). `overall` prioritises the
 * asesor review queue; `perField` colour-codes individual fields. Stored in
 * `extraction.confidence` as jsonb. Values are 0..1.
 */
export interface Confidence {
  overall: number;
  perField: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Row types — one per table in init.sql
// ---------------------------------------------------------------------------

/** `carrier` — the autónomo / micro-carrier business. */
export interface Carrier {
  id: string;
  legal_name: string;
  nif_cif: string | null;
  vat_regime: string | null;
  province: string | null;
  fleet_size: number | null;
  intl_runner: boolean;
  gasoleo_censo_status: string | null;
  status: string;
  created_at: string;
}

/** `driver` — the forwarding identity; often == carrier owner. */
export interface Driver {
  id: string;
  carrier_id: string | null;
  name: string | null;
  registered_email: string | null;
  forwarding_address: string;
  onboarding_stage: string;
  created_at: string;
}

/** `authorization_grant` — the G2 make-or-break record. */
export interface Authorization {
  id: string;
  driver_id: string | null;
  type: AuthorizationType | null;
  cert_type: CertType | null;
  status: AuthorizationStatus;
  evidence_ref: string | null;
  granted_at: string | null;
}

/** `document` — one attachment = one Document. */
export interface Document {
  id: string;
  driver_id: string | null;
  r2_key: string;
  from_addr: string | null;
  to_addr: string | null;
  message_id: string;
  attachment_index: number;
  subject: string | null;
  mime: string | null;
  size_bytes: number | null;
  source: DocumentSource;
  status: DocumentStatus;
  received_at: string;
}

/** `extraction` — LLM output + asesor corrections (= accuracy ground truth). */
export interface Extraction {
  id: string;
  document_id: string | null;
  /** jsonb — shape is {@link ExtractionFields}. */
  fields: ExtractionFields | null;
  /** jsonb — shape is {@link Confidence}. */
  confidence: Confidence | null;
  model: string | null;
  /** jsonb — asesor-corrected {@link ExtractionFields}; null until reviewed. */
  corrected_fields: ExtractionFields | null;
  status: string;
  created_at: string;
}

/** `claim` — human-assembled; € entered by the asesor. */
export interface Claim {
  id: string;
  carrier_id: string | null;
  type: ClaimType | null;
  disposition: ClaimDisposition | null;
  country: string | null;
  period: string | null;
  document_ids: string[];
  /** numeric(12,2) — pg returns numeric as string; null until entered. */
  recoverable_eur: string | null;
  asesor_minutes: number | null;
  status: ClaimStatus;
  blocked_reason: string | null;
  created_at: string;
}

/** `filing` — records the human modelo 360 filing. */
export interface Filing {
  id: string;
  claim_id: string | null;
  form: string;
  method: string;
  aeat_reference: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  status: string;
}

/** `metric_event` — append-only event stream for the four-gate dashboard. */
export interface MetricEvent {
  id: string;
  type: string;
  carrier_id: string | null;
  driver_id: string | null;
  document_id: string | null;
  claim_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

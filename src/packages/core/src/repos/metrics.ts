/**
 * `metric_event` repo (PRD 06). Append-only event stream that powers the four-gate
 * dashboard. Every meaningful action across the pipeline emits one event.
 */
import { query } from '../db.js';

export interface MetricRefs {
  carrierId?: string;
  driverId?: string;
  documentId?: string;
  claimId?: string;
}

/**
 * Emit one append-only metric event. `type` is a free-text event name (e.g.
 * 'first_doc_received', 'extraction_done', 'claim_filed'); refs link it to the
 * relevant rows; `payload` carries any extra structured detail.
 */
async function emit(
  type: string,
  refs: MetricRefs = {},
  payload?: Record<string, unknown>,
): Promise<void> {
  await query(
    `insert into metric_event (type, carrier_id, driver_id, document_id, claim_id, payload)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      type,
      refs.carrierId ?? null,
      refs.driverId ?? null,
      refs.documentId ?? null,
      refs.claimId ?? null,
      payload ? JSON.stringify(payload) : null,
    ],
  );
}

export const metrics = { emit };

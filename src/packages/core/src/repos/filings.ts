/**
 * `filing` repo (PRD 03/04). Records the human modelo 360 filing on AEAT — the POC
 * files disposition='file' (foreign-VAT) claims only. Drives the "€ filed" metric.
 */
import { query } from '../db.js';
import type { Filing } from '../types.js';

export interface FilingInput {
  claim_id: string;
  form?: string;
  method?: string;
  aeat_reference?: string | null;
  submitted_by?: string | null;
  submitted_at?: string | null;
  status?: string;
}

async function create(input: FilingInput): Promise<Filing> {
  const rows = await query<Filing>(
    `insert into filing
       (claim_id, form, method, aeat_reference, submitted_by, submitted_at, status)
     values
       ($1, coalesce($2, 'modelo_360'), coalesce($3, 'colaboracion_social'),
        $4, $5, coalesce($6, now()), coalesce($7, 'submitted'))
     returning *`,
    [
      input.claim_id,
      input.form ?? null,
      input.method ?? null,
      input.aeat_reference ?? null,
      input.submitted_by ?? null,
      input.submitted_at ?? null,
      input.status ?? null,
    ],
  );
  return rows[0]!;
}

export const filings = { create };

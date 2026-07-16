/**
 * `extraction` repo (PRD 02/03). Stores the LLM (or mock) output as jsonb and the
 * asesor's corrections. The (fields vs corrected_fields) diff is the accuracy ground
 * truth for the G3 metric (PRD 06).
 */
import { query } from '../db.js';
import type { Extraction, ExtractionFields, Confidence } from '../types.js';

export interface ExtractionInput {
  document_id: string;
  fields: ExtractionFields;
  confidence: Confidence;
  model: string;
  status?: string;
}

async function insert(x: ExtractionInput): Promise<Extraction> {
  const rows = await query<Extraction>(
    `insert into extraction (document_id, fields, confidence, model, status)
     values ($1, $2::jsonb, $3::jsonb, $4, coalesce($5, 'ready_for_review'))
     on conflict (document_id) do update set
       fields      = excluded.fields,
       confidence  = excluded.confidence,
       model       = excluded.model,
       status      = excluded.status,
       corrected_fields = null,
       created_at  = now()
     returning *`,
    [
      x.document_id,
      JSON.stringify(x.fields),
      JSON.stringify(x.confidence),
      x.model,
      x.status ?? null,
    ],
  );
  return rows[0]!;
}

/** Save the asesor's corrected fields (accuracy ground truth) onto an extraction. */
async function setCorrected(id: string, correctedFields: ExtractionFields): Promise<void> {
  await query(`update extraction set corrected_fields = $2::jsonb where id = $1`, [
    id,
    JSON.stringify(correctedFields),
  ]);
}

export const extractions = { insert, setCorrected };

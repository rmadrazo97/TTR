/**
 * Document review actions (PRD 04 §5.3–5.5). All writes go through @ttr/core repos.
 */
import type { Context } from 'hono';
import { documents, extractions, claims, metrics } from '@ttr/core';
import type { ExtractionFields } from '@ttr/core';
import { parseMoney, nullIfBlank } from '../fmt.js';

/**
 * POST /documents/:id/correct — save the asesor's 4-field correction.
 * Writes Extraction.corrected_fields, marks the Document `reviewed`, and emits
 * `field_corrected`. Works for extraction_failed docs too: if there's no extraction row
 * yet we create one first (blank manual entry), then set its corrected fields.
 */
export async function correctDocument(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!id) return c.notFound();
  const doc = await documents.get(id);
  if (!doc) return c.notFound();

  const form = await c.req.parseBody();
  const corrected: ExtractionFields = {
    vatId: nullIfBlank(form['vatId'] as string) ?? undefined,
    date: nullIfBlank(form['date'] as string) ?? undefined,
    gross: parseMoney(form['gross'] as string) ?? undefined,
    vat: parseMoney(form['vat'] as string) ?? undefined,
  };

  // extraction_failed docs may have no extraction row — create a manual-entry one.
  let extractionId = doc.extraction?.id;
  if (!extractionId) {
    const created = await extractions.insert({
      document_id: id,
      fields: {}, // no LLM output — manual entry; accuracy diff = correction vs empty
      confidence: { overall: 0, perField: {} },
      model: 'manual_entry',
      status: 'reviewed',
    });
    extractionId = created.id;
  }

  await extractions.setCorrected(extractionId, corrected);
  await documents.setStatus(id, 'reviewed');
  await metrics.emit(
    'field_corrected',
    { documentId: id, driverId: doc.driver_id ?? undefined },
    // manual=true when no real LLM output existed (extraction_failed or no extraction row).
    { corrected, manual: doc.status === 'extraction_failed' || !doc.extraction?.fields },
  );

  return c.redirect('/queue');
}

/**
 * POST /documents/:id/validate — record the MANUAL reconcile/validate verdict as a
 * metric event (notes + which checks the human performed). Nothing is automated here.
 */
export async function validateDocument(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!id) return c.notFound();
  const doc = await documents.get(id);
  if (!doc) return c.notFound();

  const form = await c.req.parseBody();
  const verdict = nullIfBlank(form['verdict'] as string);
  await metrics.emit(
    'document_validated',
    { documentId: id, driverId: doc.driver_id ?? undefined },
    {
      verdict,
      checks: {
        vies: form['check_vies'] === 'on',
        sum: form['check_sum'] === 'on',
        window: form['check_window'] === 'on',
        category: form['check_category'] === 'on',
      },
      notes: nullIfBlank(form['notes'] as string),
    },
  );

  return c.redirect(`/documents/${id}`);
}

/**
 * POST /documents/:id/add-to-claim — append this document to a claim's document_ids
 * (idempotent) and mark it `claimed`.
 */
export async function addToClaim(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!id) return c.notFound();
  const doc = await documents.get(id);
  if (!doc) return c.notFound();

  const form = await c.req.parseBody();
  const claimId = nullIfBlank(form['claim_id'] as string);
  if (!claimId) return c.redirect(`/documents/${id}`);

  const claim = await claims.get(claimId);
  if (!claim) return c.notFound();

  if (!claim.document_ids.includes(id)) {
    await claims.update(claimId, { document_ids: [...claim.document_ids, id] });
  }
  await documents.setStatus(id, 'claimed');
  await metrics.emit('document_added_to_claim', {
    documentId: id,
    claimId,
    carrierId: claim.carrier_id ?? undefined,
  });

  return c.redirect(`/claims/${claimId}`);
}

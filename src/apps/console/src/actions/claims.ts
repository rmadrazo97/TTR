/**
 * Claim assembly + filing actions (PRD 04 §5.5–5.6). All writes via @ttr/core repos.
 */
import type { Context } from 'hono';
import { claims, filings, metrics } from '@ttr/core';
import type { ClaimType, ClaimDisposition, ClaimStatus } from '@ttr/core';
import { parseMoney, parseIntOrNull, nullIfBlank } from '../fmt.js';

const CLAIM_TYPES: ClaimType[] = ['foreign_vat', 'excise', 'dietas'];
const DISPOSITIONS: ClaimDisposition[] = ['file', 'assure', 'identify_only'];
const STATUSES: ClaimStatus[] = ['draft', 'ready', 'blocked', 'filed'];

/** POST /claims — create a new claim. */
export async function createClaim(c: Context): Promise<Response> {
  const form = await c.req.parseBody();
  const carrierId = nullIfBlank(form['carrier_id'] as string);
  if (!carrierId) return c.redirect('/claims');

  const type = (form['type'] as ClaimType) ?? 'foreign_vat';
  const disposition = (form['disposition'] as ClaimDisposition) ?? 'file';
  const claim = await claims.create({
    carrier_id: carrierId,
    type: CLAIM_TYPES.includes(type) ? type : 'foreign_vat',
    disposition: DISPOSITIONS.includes(disposition) ? disposition : 'file',
    country: nullIfBlank(form['country'] as string),
    period: nullIfBlank(form['period'] as string),
  });
  await metrics.emit('claim_created', { claimId: claim.id, carrierId });
  return c.redirect(`/claims/${claim.id}`);
}

/**
 * POST /claims/:id — patch € recoverable, asesor minutes, and status (draft/ready/
 * blocked +reason). Emits claim_ready / claim_blocked on status transitions.
 */
export async function updateClaim(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!id) return c.notFound();
  const before = await claims.get(id);
  if (!before) return c.notFound();

  const form = await c.req.parseBody();
  const status = (form['status'] as ClaimStatus) ?? before.status;
  const validStatus: ClaimStatus = STATUSES.includes(status) && status !== 'filed' ? status : before.status;

  const updated = await claims.update(id, {
    recoverable_eur: parseMoney(form['recoverable_eur'] as string),
    asesor_minutes: parseIntOrNull(form['asesor_minutes'] as string),
    status: validStatus,
    blocked_reason: validStatus === 'blocked' ? nullIfBlank(form['blocked_reason'] as string) : null,
  });

  if (validStatus !== before.status) {
    if (validStatus === 'ready') {
      await metrics.emit(
        'claim_ready',
        { claimId: id, carrierId: updated.carrier_id ?? undefined },
        { recoverable_eur: updated.recoverable_eur },
      );
    } else if (validStatus === 'blocked') {
      await metrics.emit(
        'claim_blocked',
        { claimId: id, carrierId: updated.carrier_id ?? undefined },
        { reason: updated.blocked_reason },
      );
    }
  }
  return c.redirect(`/claims/${id}`);
}

/**
 * POST /claims/:id/file — record the modelo 360 filing on AEAT: create a Filing row,
 * mark the claim `filed`, emit claim_filed (drives the "€ filed" metric).
 */
export async function fileClaim(c: Context): Promise<Response> {
  const id = c.req.param('id');
  if (!id) return c.notFound();
  const claim = await claims.get(id);
  if (!claim) return c.notFound();

  // Guard: skip re-filing an already-filed claim (prevents duplicate Filing rows).
  if (claim.status === 'filed') return c.redirect(`/claims/${id}`);

  // POC files Stream A only — foreign VAT via modelo 360 (PRD 00/03). Refuse to file
  // 'assure' (gasóleo trust-hook) or 'identify_only' (excise/dietas upsell) claims, or any
  // non-foreign_vat type. The filing card is hidden for these in the UI; this is the server guard.
  if (claim.disposition !== 'file' || claim.type !== 'foreign_vat') {
    return c.redirect(`/claims/${id}`);
  }

  const form = await c.req.parseBody();
  const filing = await filings.create({
    claim_id: id,
    form: nullIfBlank(form['form'] as string) ?? 'modelo_360',
    method: nullIfBlank(form['method'] as string) ?? 'colaboracion_social',
    aeat_reference: nullIfBlank(form['aeat_reference'] as string),
    submitted_by: nullIfBlank(form['submitted_by'] as string),
  });
  await claims.update(id, { status: 'filed' });
  await metrics.emit(
    'claim_filed',
    { claimId: id, carrierId: claim.carrier_id ?? undefined },
    {
      aeat_reference: filing.aeat_reference,
      recoverable_eur: claim.recoverable_eur,
      form: filing.form,
    },
  );
  return c.redirect(`/claims/${id}`);
}

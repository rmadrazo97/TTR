/**
 * Onboarding actions (PRD 05). Signup capture (Carrier + Driver) and authorization
 * status capture. No AEAT integration — the software records the outcome the human
 * achieves. Certificate credentials are NEVER stored; only the fact + an evidence ref.
 */
import type { Context } from 'hono';
import { carriers, drivers, authorizations, metrics, query } from '@ttr/core';
import type { AuthorizationType, CertType, AuthorizationStatus } from '@ttr/core';
import { parseIntOrNull, nullIfBlank } from '../fmt.js';

/**
 * POST /onboarding — create a Carrier (ICP-screen incl. gasoleo_censo_status trust hook)
 * and a Driver (forwarding address). Emits `carrier_signed`.
 */
export async function createOnboarding(c: Context): Promise<Response> {
  const form = await c.req.parseBody();
  const legalName = nullIfBlank(form['legal_name'] as string);
  const forwarding = nullIfBlank(form['forwarding_address'] as string);
  if (!legalName || !forwarding) return c.redirect('/onboarding');

  const carrier = await carriers.create({
    legal_name: legalName,
    nif_cif: nullIfBlank(form['nif_cif'] as string),
    vat_regime: nullIfBlank(form['vat_regime'] as string),
    province: nullIfBlank(form['province'] as string),
    fleet_size: parseIntOrNull(form['fleet_size'] as string),
    intl_runner: form['intl_runner'] === 'true',
    gasoleo_censo_status: nullIfBlank(form['gasoleo_censo_status'] as string),
  });

  const driver = await drivers.create({
    carrier_id: carrier.id,
    name: nullIfBlank(form['driver_name'] as string),
    registered_email: nullIfBlank(form['registered_email'] as string),
    forwarding_address: forwarding,
    onboarding_stage: 'signed',
  });

  await metrics.emit(
    'carrier_signed',
    { carrierId: carrier.id, driverId: driver.id },
    {
      province: carrier.province,
      intl_runner: carrier.intl_runner,
      gasoleo_censo_status: carrier.gasoleo_censo_status,
      consent: form['consent'] === 'true',
    },
  );

  return c.redirect(`/onboarding?created=${encodeURIComponent(forwarding)}`);
}

const AUTH_TYPES: AuthorizationType[] = ['apoderamiento', 'colaborador_social'];
const CERT_TYPES: CertType[] = ['FNMT', 'Clave'];
const AUTH_STATUSES: AuthorizationStatus[] = ['requested', 'granted', 'verified'];

/**
 * POST /onboarding/authorization — record or advance a driver's authorization grant
 * (apoderamiento / colaborador social) + certificate type + evidence ref. Emits
 * `authorization_granted` when reaching granted/verified.
 */
export async function recordAuthorization(c: Context): Promise<Response> {
  const form = await c.req.parseBody();
  const driverId = nullIfBlank(form['driver_id'] as string);
  if (!driverId) return c.redirect('/onboarding');

  const type = (form['type'] as AuthorizationType) ?? 'apoderamiento';
  const certRaw = nullIfBlank(form['cert_type'] as string) as CertType | null;
  const status = (form['status'] as AuthorizationStatus) ?? 'requested';
  const grantedNow = status === 'granted' || status === 'verified';

  const grant = await authorizations.upsert({
    driver_id: driverId,
    type: AUTH_TYPES.includes(type) ? type : 'apoderamiento',
    cert_type: certRaw && CERT_TYPES.includes(certRaw) ? certRaw : null,
    status: AUTH_STATUSES.includes(status) ? status : 'requested',
    evidence_ref: nullIfBlank(form['evidence_ref'] as string),
    granted_at: grantedNow ? new Date().toISOString() : null,
  });

  const driver = await drivers.get(driverId);
  if (grantedNow) {
    await metrics.emit(
      'authorization_granted',
      { driverId, carrierId: driver?.carrier_id ?? undefined },
      { type: grant.type, cert_type: grant.cert_type, status: grant.status },
    );
    if (driver && driver.onboarding_stage !== 'authorized') {
      // Advance the funnel stage (best-effort; drivers repo has no update method).
      await query(`update driver set onboarding_stage = 'authorized' where id = $1`, [driverId]);
    }
  }

  return c.redirect('/onboarding');
}

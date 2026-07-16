/**
 * Onboarding status-board reads (PRD 05). Joins driver ↔ carrier ↔ authorization_grant
 * and counts each driver's documents so the board can show the funnel and the manual
 * "granted-but-no-docs" nudge list (the direct G2 lever, PRD 05 §5.7).
 */
import { query } from '@ttr/core';
import type { AuthorizationStatus, AuthorizationType, CertType } from '@ttr/core';

export interface OnboardingRow {
  driver_id: string;
  driver_name: string | null;
  forwarding_address: string;
  onboarding_stage: string;
  carrier_id: string | null;
  carrier_name: string | null;
  province: string | null;
  gasoleo_censo_status: string | null;
  auth_type: AuthorizationType | null;
  cert_type: CertType | null;
  auth_status: AuthorizationStatus | null;
  granted: boolean; // apoderamiento/colaborador granted or verified
  doc_count: number;
}

/** All drivers with their carrier, latest apoderamiento grant, and doc count. */
export async function listOnboarding(): Promise<OnboardingRow[]> {
  const rows = await query<Omit<OnboardingRow, 'granted' | 'doc_count'> & { doc_count: string }>(
    `select
       d.id as driver_id,
       d.name as driver_name,
       d.forwarding_address,
       d.onboarding_stage,
       c.id as carrier_id,
       c.legal_name as carrier_name,
       c.province,
       c.gasoleo_censo_status,
       ag.type as auth_type,
       ag.cert_type,
       ag.status as auth_status,
       (select count(*) from document doc where doc.driver_id = d.id)::text as doc_count
     from driver d
     left join carrier c on c.id = d.carrier_id
     left join lateral (
       select * from authorization_grant a
        where a.driver_id = d.id
        order by (a.status = 'verified') desc, (a.status = 'granted') desc, a.granted_at desc nulls last
        limit 1
     ) ag on true
     order by d.created_at asc`,
  );
  return rows.map((r) => ({
    ...r,
    doc_count: Number(r.doc_count),
    granted: r.auth_status === 'granted' || r.auth_status === 'verified',
  }));
}

/** The manual nudge list: granted apoderamiento but 0 documents sent. */
export function grantedButNoDocs(rows: OnboardingRow[]): OnboardingRow[] {
  return rows.filter((r) => r.granted && r.doc_count === 0);
}

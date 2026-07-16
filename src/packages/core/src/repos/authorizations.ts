/**
 * `authorization_grant` repo — the G2 make-or-break record (PRD 03/05).
 * `upsert` keeps one live grant per (driver_id, type): if one exists it's updated,
 * else inserted. Idempotent so onboarding steps can re-run safely.
 */
import { query } from '../db.js';
import type { Authorization, AuthorizationType, CertType, AuthorizationStatus } from '../types.js';

export interface AuthorizationInput {
  driver_id: string;
  type: AuthorizationType;
  cert_type?: CertType | null;
  status?: AuthorizationStatus;
  evidence_ref?: string | null;
  granted_at?: string | null;
}

/**
 * Insert or update the driver's authorization of the given `type` in ONE atomic
 * statement via the `unique (driver_id, type)` constraint (init.sql). A null field in
 * the update path leaves the existing value untouched (coalesce on the params, NOT on
 * `excluded`, so a re-run with `status` omitted never downgrades a `granted` back to
 * `requested`). The prior find-then-write could race two concurrent onboarding steps
 * into duplicate live grants.
 */
async function upsert(input: AuthorizationInput): Promise<Authorization> {
  const rows = await query<Authorization>(
    `insert into authorization_grant (driver_id, type, cert_type, status, evidence_ref, granted_at)
     values ($1, $2, $3, coalesce($4, 'requested'), $5, $6)
     on conflict (driver_id, type) do update set
       cert_type    = coalesce($3, authorization_grant.cert_type),
       status       = coalesce($4, authorization_grant.status),
       evidence_ref = coalesce($5, authorization_grant.evidence_ref),
       granted_at   = coalesce($6, authorization_grant.granted_at)
     returning *`,
    [
      input.driver_id,
      input.type,
      input.cert_type ?? null,
      input.status ?? null,
      input.evidence_ref ?? null,
      input.granted_at ?? null,
    ],
  );
  return rows[0]!;
}

export const authorizations = { upsert };

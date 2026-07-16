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
 * Insert or update the driver's authorization of the given `type`. There's no unique
 * constraint in the DDL, so this does an explicit find-then-write to stay idempotent.
 */
async function upsert(input: AuthorizationInput): Promise<Authorization> {
  const existing = await query<Authorization>(
    `select * from authorization_grant where driver_id = $1 and type = $2 limit 1`,
    [input.driver_id, input.type],
  );

  if (existing[0]) {
    const rows = await query<Authorization>(
      `update authorization_grant
          set cert_type    = coalesce($2, cert_type),
              status       = coalesce($3, status),
              evidence_ref = coalesce($4, evidence_ref),
              granted_at   = coalesce($5, granted_at)
        where id = $1
        returning *`,
      [
        existing[0].id,
        input.cert_type ?? null,
        input.status ?? null,
        input.evidence_ref ?? null,
        input.granted_at ?? null,
      ],
    );
    return rows[0]!;
  }

  const rows = await query<Authorization>(
    `insert into authorization_grant (driver_id, type, cert_type, status, evidence_ref, granted_at)
     values ($1, $2, $3, coalesce($4, 'requested'), $5, $6)
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

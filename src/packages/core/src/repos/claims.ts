/**
 * `claim` repo (PRD 03/04). Human-assembled: the asesor groups validated documents,
 * enters the recoverable €, and moves the claim draft → ready|blocked → filed.
 * `update` is a partial patch over the mutable columns.
 */
import { query } from '../db.js';
import type { Claim, ClaimType, ClaimDisposition, ClaimStatus } from '../types.js';

export interface ClaimInput {
  carrier_id: string;
  type: ClaimType;
  disposition: ClaimDisposition;
  country?: string | null;
  period?: string | null;
  document_ids?: string[];
  recoverable_eur?: number | string | null;
  asesor_minutes?: number | null;
  status?: ClaimStatus;
  blocked_reason?: string | null;
}

/** Fields the asesor can patch on an existing claim. */
export interface ClaimPatch {
  type?: ClaimType;
  disposition?: ClaimDisposition;
  country?: string | null;
  period?: string | null;
  document_ids?: string[];
  recoverable_eur?: number | string | null;
  asesor_minutes?: number | null;
  status?: ClaimStatus;
  blocked_reason?: string | null;
}

async function create(input: ClaimInput): Promise<Claim> {
  const rows = await query<Claim>(
    `insert into claim
       (carrier_id, type, disposition, country, period, document_ids,
        recoverable_eur, asesor_minutes, status, blocked_reason)
     values ($1, $2, $3, $4, $5, coalesce($6::uuid[], '{}'), $7, $8, coalesce($9, 'draft'), $10)
     returning *`,
    [
      input.carrier_id,
      input.type,
      input.disposition,
      input.country ?? null,
      input.period ?? null,
      input.document_ids ?? null,
      input.recoverable_eur ?? null,
      input.asesor_minutes ?? null,
      input.status ?? null,
      input.blocked_reason ?? null,
    ],
  );
  return rows[0]!;
}

/**
 * Patch the mutable columns of a claim. Only the keys present on `patch` are written;
 * everything else is left untouched. Throws if the claim doesn't exist or patch is empty.
 */
async function update(id: string, patch: ClaimPatch): Promise<Claim> {
  const cols: string[] = [];
  const params: unknown[] = [id];

  const set = (col: string, val: unknown): void => {
    params.push(val);
    cols.push(`${col} = $${params.length}`);
  };

  if ('type' in patch) set('type', patch.type);
  if ('disposition' in patch) set('disposition', patch.disposition);
  if ('country' in patch) set('country', patch.country ?? null);
  if ('period' in patch) set('period', patch.period ?? null);
  if ('document_ids' in patch) set('document_ids', patch.document_ids ?? []);
  if ('recoverable_eur' in patch) set('recoverable_eur', patch.recoverable_eur ?? null);
  if ('asesor_minutes' in patch) set('asesor_minutes', patch.asesor_minutes ?? null);
  if ('status' in patch) set('status', patch.status);
  if ('blocked_reason' in patch) set('blocked_reason', patch.blocked_reason ?? null);

  if (cols.length === 0) {
    throw new Error('[@ttr/core claims.update] empty patch');
  }

  const rows = await query<Claim>(
    `update claim set ${cols.join(', ')} where id = $1 returning *`,
    params,
  );
  if (!rows[0]) throw new Error(`[@ttr/core claims.update] no claim with id ${id}`);
  return rows[0];
}

async function list(carrierId?: string): Promise<Claim[]> {
  if (carrierId) {
    return query<Claim>(`select * from claim where carrier_id = $1 order by created_at asc`, [
      carrierId,
    ]);
  }
  return query<Claim>(`select * from claim order by created_at asc`);
}

async function get(id: string): Promise<Claim | null> {
  const rows = await query<Claim>(`select * from claim where id = $1`, [id]);
  return rows[0] ?? null;
}

export const claims = { create, update, list, get };

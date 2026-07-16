/**
 * `carrier` repo — the autónomo / micro-carrier business (PRD 03).
 * Plain parameterised SQL; column names mirror init.sql exactly.
 */
import { query } from '../db.js';
import type { Carrier } from '../types.js';

export interface CarrierInput {
  legal_name: string;
  nif_cif?: string | null;
  vat_regime?: string | null;
  province?: string | null;
  fleet_size?: number | null;
  intl_runner?: boolean;
  gasoleo_censo_status?: string | null;
  status?: string;
}

async function create(input: CarrierInput): Promise<Carrier> {
  const rows = await query<Carrier>(
    `insert into carrier
       (legal_name, nif_cif, vat_regime, province, fleet_size, intl_runner, gasoleo_censo_status, status)
     values ($1, $2, $3, $4, $5, coalesce($6, false), $7, coalesce($8, 'active'))
     returning *`,
    [
      input.legal_name,
      input.nif_cif ?? null,
      input.vat_regime ?? null,
      input.province ?? null,
      input.fleet_size ?? null,
      input.intl_runner ?? null,
      input.gasoleo_censo_status ?? null,
      input.status ?? null,
    ],
  );
  return rows[0]!;
}

async function get(id: string): Promise<Carrier | null> {
  const rows = await query<Carrier>(`select * from carrier where id = $1`, [id]);
  return rows[0] ?? null;
}

async function list(): Promise<Carrier[]> {
  return query<Carrier>(`select * from carrier order by created_at asc`);
}

export const carriers = { create, get, list };

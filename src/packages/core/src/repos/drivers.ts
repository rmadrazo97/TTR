/**
 * `driver` repo — the forwarding identity (PRD 03). `forwarding_address` is unique;
 * the ingest handler resolves an inbound `to` address to a driver via
 * {@link findByForwardingAddress}.
 */
import { query } from '../db.js';
import type { Driver } from '../types.js';

export interface DriverInput {
  carrier_id?: string | null;
  name?: string | null;
  registered_email?: string | null;
  forwarding_address: string;
  onboarding_stage?: string;
}

async function create(input: DriverInput): Promise<Driver> {
  const rows = await query<Driver>(
    `insert into driver
       (carrier_id, name, registered_email, forwarding_address, onboarding_stage)
     values ($1, $2, $3, $4, coalesce($5, 'signed'))
     returning *`,
    [
      input.carrier_id ?? null,
      input.name ?? null,
      input.registered_email ?? null,
      input.forwarding_address,
      input.onboarding_stage ?? null,
    ],
  );
  return rows[0]!;
}

/** Resolve an inbound forwarding address (case-insensitive) to its driver, or null. */
async function findByForwardingAddress(addr: string): Promise<Driver | null> {
  const rows = await query<Driver>(
    `select * from driver where lower(forwarding_address) = lower($1)`,
    [addr],
  );
  return rows[0] ?? null;
}

async function get(id: string): Promise<Driver | null> {
  const rows = await query<Driver>(`select * from driver where id = $1`, [id]);
  return rows[0] ?? null;
}

async function list(): Promise<Driver[]> {
  return query<Driver>(`select * from driver order by created_at asc`);
}

export const drivers = { create, findByForwardingAddress, get, list };

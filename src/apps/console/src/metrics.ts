/**
 * Dashboard gate computations (PRD 06). Read-only aggregate queries over the same
 * Postgres the repos write to — using the `query` seam re-exported from @ttr/core so
 * the console stays a single-dependency app. Kept honest: € reported is € *filed*.
 *
 * The four gates:
 *  - G2 — % of onboarded who granted apoderamiento AND sent >=1 document.
 *  - G3 — extraction accuracy on the 4 fields (from corrected_fields diffs) +
 *         median € recovered per international truck (filed claims only).
 *  - G4 — % of WTP interviews accepting the ~15% fee (metric_event 'wtp_response').
 */
import { query } from '@ttr/core';
import type { ExtractionFields } from '@ttr/core';

/** The 4 accuracy-scored fields (PRD 02/06). */
export const SCORED_FIELDS = ['vatId', 'date', 'gross', 'vat'] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

export interface GateSummary {
  // G2
  onboardedCount: number;
  grantedAndSentCount: number;
  g2Rate: number | null; // 0..1 or null when denominator 0
  // G3 accuracy
  reviewedDocs: number;
  fieldTotal: number;
  fieldCorrect: number;
  accuracy: number | null; // 0..1
  perField: Record<ScoredField, { total: number; correct: number; rate: number | null }>;
  confirmedCount: number; // extractions confirmed with no edits
  editedCount: number; // extractions with at least one edited field
  // G3 € recovered
  filedClaimCount: number;
  totalFiledEur: number;
  intlTrucks: number;
  medianEurPerTruck: number | null;
  // cross-cut: identified vs filed
  identifiedEur: number; // recoverable_eur on ready+filed claims
  // G4
  wtpTotal: number;
  wtpAccepted: number;
  g4Rate: number | null;
}

/**
 * Normalise a field value for accuracy comparison (PRD 06 §12 open question — we pick
 * a defensible normalisation: trim + case-fold strings, round money to cents, ISO-date
 * prefix). Exposed so tests can pin the definition.
 */
export function normaliseField(field: ScoredField, v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (field === 'gross' || field === 'vat') {
    const n = typeof v === 'string' ? Number.parseFloat(v) : (v as number);
    if (typeof n !== 'number' || Number.isNaN(n)) return null;
    return n.toFixed(2);
  }
  if (field === 'date') {
    return String(v).slice(0, 10);
  }
  // vatId: strip spaces, upper-case (VAT-ID formatting is cosmetic).
  return String(v).replace(/\s+/g, '').toUpperCase();
}

/**
 * Compare one extraction's original `fields` against the asesor's `corrected_fields`
 * across the 4 scored fields. A field counts as "correct" when the original matched the
 * correction (or both were absent). Returns per-field correctness + whether any edit.
 */
export function scoreExtraction(
  fields: ExtractionFields | null,
  corrected: ExtractionFields | null,
): { correct: Record<ScoredField, boolean>; edited: boolean } {
  const correct = {} as Record<ScoredField, boolean>;
  let edited = false;
  for (const f of SCORED_FIELDS) {
    const a = normaliseField(f, fields?.[f]);
    const b = normaliseField(f, corrected?.[f]);
    const ok = a === b;
    correct[f] = ok;
    if (!ok) edited = true;
  }
  return { correct, edited };
}

/** Median of a numeric array, or null if empty. */
export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** Compute the full gate summary from the database. */
export async function computeGates(): Promise<GateSummary> {
  // --- G2: onboarded drivers, and those who granted + sent a doc ---
  const g2 = await query<{ onboarded: string; granted_and_sent: string }>(
    `with onboarded as (
       select id from driver
     ),
     granted as (
       select distinct driver_id from authorization_grant
        where type = 'apoderamiento' and status in ('granted','verified')
     ),
     sent as (
       select distinct driver_id from document where driver_id is not null
     )
     select
       (select count(*) from onboarded)::text as onboarded,
       (select count(*) from onboarded o
          where o.id in (select driver_id from granted)
            and o.id in (select driver_id from sent))::text as granted_and_sent`,
  );
  const onboardedCount = Number(g2[0]?.onboarded ?? 0);
  const grantedAndSentCount = Number(g2[0]?.granted_and_sent ?? 0);

  // --- G3 accuracy: reviewed extractions (corrected_fields present) ---
  const rows = await query<{ fields: ExtractionFields | null; corrected_fields: ExtractionFields | null }>(
    `select fields, corrected_fields from extraction where corrected_fields is not null`,
  );
  const perField = {} as GateSummary['perField'];
  for (const f of SCORED_FIELDS) perField[f] = { total: 0, correct: 0, rate: null };
  let fieldTotal = 0;
  let fieldCorrect = 0;
  let confirmedCount = 0;
  let editedCount = 0;
  for (const r of rows) {
    const { correct, edited } = scoreExtraction(r.fields, r.corrected_fields);
    if (edited) editedCount++;
    else confirmedCount++;
    for (const f of SCORED_FIELDS) {
      perField[f].total++;
      fieldTotal++;
      if (correct[f]) {
        perField[f].correct++;
        fieldCorrect++;
      }
    }
  }
  for (const f of SCORED_FIELDS) {
    const pf = perField[f];
    pf.rate = pf.total > 0 ? pf.correct / pf.total : null;
  }
  const accuracy = fieldTotal > 0 ? fieldCorrect / fieldTotal : null;

  // --- G3 €: filed claims (disposition='file') recoverable, per int'l truck ---
  const filed = await query<{ recoverable_eur: string | null }>(
    `select recoverable_eur from claim where status = 'filed'`,
  );
  const filedAmts = filed
    .map((r) => (r.recoverable_eur == null ? null : Number.parseFloat(r.recoverable_eur)))
    .filter((n): n is number => n != null && !Number.isNaN(n));
  const totalFiledEur = filedAmts.reduce((a, b) => a + b, 0);

  // Denominator: distinct international trucks (drivers) with at least one filed claim's
  // documents — approximated at carrier level via intl_runner flag (PRD 06 §12 note).
  const trucks = await query<{ intl_trucks: string }>(
    `select count(distinct d.id)::text as intl_trucks
       from driver d
       join carrier c on c.id = d.carrier_id and c.intl_runner = true`,
  );
  const intlTrucks = Number(trucks[0]?.intl_trucks ?? 0);

  // Per-truck median: recoverable_eur of filed claims attributed to a carrier's drivers.
  const perTruck = await query<{ driver_id: string; total: string }>(
    `select d.id as driver_id, coalesce(sum(cl.recoverable_eur),0)::text as total
       from driver d
       join carrier c on c.id = d.carrier_id and c.intl_runner = true
       left join claim cl on cl.carrier_id = c.id and cl.status = 'filed'
      group by d.id`,
  );
  const perTruckAmts = perTruck
    .map((r) => Number.parseFloat(r.total))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const medianEurPerTruck = median(perTruckAmts);

  // Identified vs filed: recoverable on ready OR filed claims.
  const identified = await query<{ total: string | null }>(
    `select coalesce(sum(recoverable_eur),0)::text as total
       from claim where status in ('ready','filed')`,
  );
  const identifiedEur = Number.parseFloat(identified[0]?.total ?? '0') || 0;

  // --- G4: WTP interviews ---
  const wtp = await query<{ total: string; accepted: string }>(
    `select
       count(*)::text as total,
       count(*) filter (where payload->>'accepted' = 'true')::text as accepted
     from metric_event where type = 'wtp_response'`,
  );
  const wtpTotal = Number(wtp[0]?.total ?? 0);
  const wtpAccepted = Number(wtp[0]?.accepted ?? 0);

  return {
    onboardedCount,
    grantedAndSentCount,
    g2Rate: onboardedCount > 0 ? grantedAndSentCount / onboardedCount : null,
    reviewedDocs: rows.length,
    fieldTotal,
    fieldCorrect,
    accuracy,
    perField,
    confirmedCount,
    editedCount,
    filedClaimCount: filed.length,
    totalFiledEur,
    intlTrucks,
    medianEurPerTruck,
    identifiedEur,
    wtpTotal,
    wtpAccepted,
    g4Rate: wtpTotal > 0 ? wtpAccepted / wtpTotal : null,
  };
}

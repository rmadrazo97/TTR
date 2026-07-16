/**
 * Per-driver recovery statement data (PRD 04 §5.7) — the WTP / referral asset (G4).
 *
 * Three lines that map to the three tax streams + their dispositions (dossier §6.3):
 *  - gasóleo €X **assured**   (disposition='assure')      → the trust hook
 *  - foreign VAT €Y **filed** (disposition='file' + filed) → the money
 *  - excise/dietas €Z **identified** (disposition='identify_only') → the upsell
 * plus € **identified** vs € **filed** overall.
 *
 * Claims live at the carrier level (schema), so a driver's statement rolls up their
 * carrier's claims — appropriate for the owner-operator ICP (driver == carrier owner).
 */
import { query } from '@ttr/core';
import type { Carrier, Driver } from '@ttr/core';

export interface DriverStatement {
  driver: Driver;
  carrier: Carrier | null;
  gasoleoAssuredEur: number; // disposition='assure' (any status)
  foreignVatFiledEur: number; // disposition='file' AND status='filed'
  foreignVatReadyEur: number; // disposition='file' AND status='ready' (identified, not yet filed)
  exciseDietasIdentifiedEur: number; // disposition='identify_only'
  identifiedEur: number; // everything not-yet-filed but recoverable (ready + identify_only + assure)
  filedEur: number; // = foreignVatFiledEur
  docCount: number;
}

function num(v: string | null | undefined): number {
  if (v == null) return 0;
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}

/** Build the recovery statement for one driver, or null if the driver doesn't exist. */
export async function buildStatement(driverId: string): Promise<DriverStatement | null> {
  const drv = await query<Driver>(`select * from driver where id = $1`, [driverId]);
  const driver = drv[0];
  if (!driver) return null;

  let carrier: Carrier | null = null;
  if (driver.carrier_id) {
    const c = await query<Carrier>(`select * from carrier where id = $1`, [driver.carrier_id]);
    carrier = c[0] ?? null;
  }

  // Aggregate the carrier's claims by disposition/status.
  const agg = carrier
    ? await query<{
        assure: string | null;
        file_filed: string | null;
        file_ready: string | null;
        identify: string | null;
      }>(
        `select
           coalesce(sum(recoverable_eur) filter (where disposition = 'assure'), 0)::text as assure,
           coalesce(sum(recoverable_eur) filter (where disposition = 'file' and status = 'filed'), 0)::text as file_filed,
           coalesce(sum(recoverable_eur) filter (where disposition = 'file' and status = 'ready'), 0)::text as file_ready,
           coalesce(sum(recoverable_eur) filter (where disposition = 'identify_only'), 0)::text as identify
         from claim where carrier_id = $1`,
        [carrier.id],
      )
    : [];
  const a = agg[0] ?? { assure: '0', file_filed: '0', file_ready: '0', identify: '0' };

  const gasoleoAssuredEur = num(a.assure);
  const foreignVatFiledEur = num(a.file_filed);
  const foreignVatReadyEur = num(a.file_ready);
  const exciseDietasIdentifiedEur = num(a.identify);

  // How many of the driver's documents feed all this.
  const dc = await query<{ n: string }>(
    `select count(*)::text as n from document where driver_id = $1`,
    [driverId],
  );
  const docCount = Number(dc[0]?.n ?? 0);

  const identifiedEur = gasoleoAssuredEur + foreignVatReadyEur + exciseDietasIdentifiedEur;

  return {
    driver,
    carrier,
    gasoleoAssuredEur,
    foreignVatFiledEur,
    foreignVatReadyEur,
    exciseDietasIdentifiedEur,
    identifiedEur,
    filedEur: foreignVatFiledEur,
    docCount,
  };
}

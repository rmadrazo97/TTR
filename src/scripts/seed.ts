/**
 * Idempotent synthetic seed. Inserts 2 carriers + their drivers (with forwarding
 * addresses like juan.perez@ingest.ttr.example) so the ingest → extract → review
 * pipeline has something to resolve `to` addresses against.
 *
 * SYNTHETIC DATA ONLY. Run: `npm run seed` (from src/), or `tsx scripts/seed.ts`.
 * Idempotent: it upserts on the driver's unique forwarding_address, so re-running
 * won't create duplicates.
 */
import {
  loadConfig,
  query,
  carriers,
  drivers,
  authorizations,
  metrics,
  closePool,
  type Carrier,
  type Driver,
} from '@ttr/core';

interface SeedCarrier {
  carrier: {
    legal_name: string;
    nif_cif: string;
    vat_regime: string;
    province: string;
    fleet_size: number;
    intl_runner: boolean;
    gasoleo_censo_status: string;
  };
  drivers: Array<{
    name: string;
    registered_email: string;
    localpart: string; // becomes localpart@{ingestDomain}
    onboarding_stage: string;
  }>;
}

const DATA: SeedCarrier[] = [
  {
    carrier: {
      legal_name: 'Transportes Pérez S.L.',
      nif_cif: 'B12345678',
      vat_regime: 'estimacion_directa',
      province: 'Madrid',
      fleet_size: 3,
      intl_runner: true,
      gasoleo_censo_status: 'enrolled',
    },
    drivers: [
      {
        name: 'Juan Pérez',
        registered_email: 'juan.perez@example.com',
        localpart: 'juan.perez',
        onboarding_stage: 'authorized',
      },
      {
        name: 'María Gómez',
        registered_email: 'maria.gomez@example.com',
        localpart: 'maria.gomez',
        onboarding_stage: 'signed',
      },
    ],
  },
  {
    carrier: {
      legal_name: 'Logística Andalucía S.C.',
      nif_cif: 'J87654321',
      vat_regime: 'estimacion_directa',
      province: 'Sevilla',
      fleet_size: 1,
      intl_runner: true,
      gasoleo_censo_status: 'pending',
    },
    drivers: [
      {
        name: 'Antonio Ruiz',
        registered_email: 'antonio.ruiz@example.com',
        localpart: 'antonio.ruiz',
        onboarding_stage: 'authorized',
      },
    ],
  },
];

/** Find an existing carrier by NIF/CIF (idempotency key), else create it. */
async function upsertCarrier(c: SeedCarrier['carrier']): Promise<Carrier> {
  const existing = await query<Carrier>(`select * from carrier where nif_cif = $1 limit 1`, [
    c.nif_cif,
  ]);
  if (existing[0]) return existing[0];
  return carriers.create(c);
}

async function main(): Promise<void> {
  const { ingestDomain } = loadConfig();
  let carrierCount = 0;
  let driverCount = 0;

  for (const item of DATA) {
    const carrier = await upsertCarrier(item.carrier);
    carrierCount++;
    await metrics.emit('carrier_signed', { carrierId: carrier.id }, { seed: true });

    for (const d of item.drivers) {
      const forwarding = `${d.localpart}@${ingestDomain}`;
      let driver: Driver | null = await drivers.findByForwardingAddress(forwarding);
      if (!driver) {
        driver = await drivers.create({
          carrier_id: carrier.id,
          name: d.name,
          registered_email: d.registered_email,
          forwarding_address: forwarding,
          onboarding_stage: d.onboarding_stage,
        });
      }
      driverCount++;

      // Authorized drivers get a granted apoderamiento (G2). Idempotent upsert.
      if (d.onboarding_stage === 'authorized') {
        await authorizations.upsert({
          driver_id: driver.id,
          type: 'apoderamiento',
          cert_type: 'FNMT',
          status: 'granted',
          granted_at: new Date().toISOString(),
        });
        await metrics.emit(
          'authorization_granted',
          { carrierId: carrier.id, driverId: driver.id },
          { seed: true },
        );
      }

      // eslint-disable-next-line no-console
      console.log(`  driver ${d.name.padEnd(16)} → ${forwarding}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\nSeed complete: ${carrierCount} carriers, ${driverCount} drivers (idempotent).`);
  await closePool();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exitCode = 1;
});

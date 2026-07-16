import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Route-handler smoke tests. The whole @ttr/core module is mocked so no DB/S3 is
 * touched: repo reads return fixtures, writes are spies. We assert:
 *  - each GET page returns 200 with the shared Basic-Auth credential (and 401 without),
 *  - a correction POST persists corrected_fields + flips the document to `reviewed`.
 */

// --- fixtures -------------------------------------------------------------
const doc = {
  id: 'doc-1',
  driver_id: 'drv-1',
  r2_key: 'receipts/drv-1/2026/05/m-0.jpg',
  from_addr: 'a@b.c',
  to_addr: 'drv1@ingest.ttr.example',
  message_id: 'm-1',
  attachment_index: 0,
  subject: 'recibo',
  mime: 'image/jpeg',
  size_bytes: 1000,
  source: 'forwarded',
  status: 'ready_for_review',
  received_at: '2026-05-01T00:00:00Z',
  extraction: {
    id: 'ex-1',
    document_id: 'doc-1',
    fields: { vatId: 'FR123', date: '2026-05-01', gross: 100, vat: 21, supplier: 'Total' },
    confidence: { overall: 0.8, perField: { vatId: 0.9, date: 0.7, gross: 0.6, vat: 0.5 } },
    model: 'mock-vision-0',
    corrected_fields: null,
    status: 'ready_for_review',
    created_at: '2026-05-01T00:05:00Z',
  },
};
const carrier = {
  id: 'car-1',
  legal_name: 'Transportes Prueba SL',
  nif_cif: 'B123',
  vat_regime: 'estimacion_directa',
  province: 'Murcia',
  fleet_size: 3,
  intl_runner: true,
  gasoleo_censo_status: 'enrolled',
  status: 'active',
  created_at: '2026-04-01T00:00:00Z',
};
const driver = {
  id: 'drv-1',
  carrier_id: 'car-1',
  name: 'Juan',
  registered_email: 'juan@x.es',
  forwarding_address: 'drv1@ingest.ttr.example',
  onboarding_stage: 'authorized',
  created_at: '2026-04-01T00:00:00Z',
};
const claim = {
  id: 'clm-1',
  carrier_id: 'car-1',
  type: 'foreign_vat',
  disposition: 'file',
  country: 'FR',
  period: '2026-Q2',
  document_ids: ['doc-1'],
  recoverable_eur: '210.00',
  asesor_minutes: 30,
  status: 'ready',
  blocked_reason: null,
  created_at: '2026-05-02T00:00:00Z',
};

// --- spies (declared via vi.hoisted so the mock factory can close over them) ---
const h = vi.hoisted(() => ({
  setCorrected: vi.fn(async () => {}),
  setStatus: vi.fn(async () => {}),
  insertExtraction: vi.fn(async () => ({ id: 'ex-new' })),
  emit: vi.fn(async () => {}),
}));

vi.mock('@ttr/core', () => ({
  documents: {
    get: vi.fn(async (id: string) => (id === 'doc-1' ? doc : null)),
    listForReview: vi.fn(async () => [doc]),
    setStatus: h.setStatus,
    insert: vi.fn(async () => ({ document: doc, created: true })),
  },
  extractions: {
    insert: h.insertExtraction,
    setCorrected: h.setCorrected,
  },
  claims: {
    list: vi.fn(async () => [claim]),
    get: vi.fn(async (id: string) => (id === 'clm-1' ? claim : null)),
    create: vi.fn(async () => claim),
    update: vi.fn(async () => claim),
  },
  carriers: {
    list: vi.fn(async () => [carrier]),
    get: vi.fn(async () => carrier),
    create: vi.fn(async () => carrier),
  },
  drivers: {
    list: vi.fn(async () => [driver]),
    get: vi.fn(async () => driver),
    create: vi.fn(async () => driver),
  },
  authorizations: { upsert: vi.fn(async () => ({ id: 'auth-1' })) },
  filings: { create: vi.fn(async () => ({ id: 'fil-1', form: 'modelo_360' })) },
  metrics: { emit: h.emit },
  getSignedUrl: vi.fn(async () => 'https://signed.example/receipt.jpg'),
  putObject: vi.fn(async () => {}),
  query: vi.fn(async (sql: string) => {
    // computeGates + statements + onboarding issue several aggregate queries; return
    // shapes that satisfy the callers (counts as text, empty aggregates).
    if (/from filing/i.test(sql)) return [];
    if (/count\(\*\)/i.test(sql) && /granted_and_sent/i.test(sql))
      return [{ onboarded: '1', granted_and_sent: '1' }];
    if (/from extraction where corrected_fields/i.test(sql)) return [];
    if (/from claim where status = 'filed'/i.test(sql)) return [];
    if (/intl_trucks/i.test(sql)) return [{ intl_trucks: '1' }];
    if (/group by d\.id/i.test(sql)) return [{ driver_id: 'drv-1', total: '0' }];
    if (/status in \('ready','filed'\)/i.test(sql)) return [{ total: '0' }];
    if (/wtp_response/i.test(sql)) return [{ total: '0', accepted: '0' }];
    if (/from driver where id/i.test(sql)) return [driver];
    if (/from carrier where id/i.test(sql)) return [carrier];
    if (/from claim where carrier_id/i.test(sql))
      return [{ assure: '0', file_filed: '0', file_ready: '0', identify: '0' }];
    if (/from document where driver_id/i.test(sql)) return [{ n: '1' }];
    if (/from driver d/i.test(sql))
      return [
        {
          driver_id: 'drv-1',
          driver_name: 'Juan',
          forwarding_address: 'drv1@ingest.ttr.example',
          onboarding_stage: 'authorized',
          carrier_id: 'car-1',
          carrier_name: 'Transportes Prueba SL',
          province: 'Murcia',
          gasoleo_censo_status: 'enrolled',
          auth_type: 'apoderamiento',
          cert_type: 'FNMT',
          auth_status: 'granted',
          doc_count: '2',
        },
      ];
    return [];
  }),
}));

const { createApp } = await import('../app.js');

// Basic-Auth header for the dev-default credential (auth.ts).
const AUTH = 'Basic ' + Buffer.from('asesor:ttr_dev_pw').toString('base64');
const authed = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, {
    ...init,
    headers: { Authorization: AUTH, ...(init.headers ?? {}) },
  });

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp();
  h.setCorrected.mockClear();
  h.setStatus.mockClear();
  h.insertExtraction.mockClear();
  h.emit.mockClear();
});

describe('auth', () => {
  it('401s without credentials', async () => {
    const res = await app.request('http://localhost/queue');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
  });
  it('healthz is open (no auth)', async () => {
    const res = await app.request('http://localhost/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe('GET pages return 200', () => {
  const pages = [
    '/',
    '/queue',
    '/documents/doc-1',
    '/claims',
    '/claims/clm-1',
    '/statements/drv-1',
    '/upload',
    '/onboarding',
  ];
  for (const p of pages) {
    it(`GET ${p}`, async () => {
      const res = await app.request(authed(p));
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('<!DOCTYPE html>');
      expect(body).toContain('TTR');
    });
  }
});

describe('POST /documents/:id/correct persists correction + status', () => {
  it('writes corrected_fields and flips the document to reviewed', async () => {
    const body = new URLSearchParams({
      vatId: 'FR999',
      date: '2026-05-02',
      gross: '120,50', // es-ES decimal
      vat: '25.00',
    });
    const res = await app.request(
      authed('/documents/doc-1/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }),
    );
    // redirect back to the queue
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/queue');

    // corrected fields persisted onto the existing extraction
    expect(h.setCorrected).toHaveBeenCalledTimes(1);
    const [exId, corrected] = h.setCorrected.mock.calls[0]!;
    expect(exId).toBe('ex-1');
    expect(corrected).toEqual({ vatId: 'FR999', date: '2026-05-02', gross: 120.5, vat: 25 });

    // document marked reviewed
    expect(h.setStatus).toHaveBeenCalledWith('doc-1', 'reviewed');

    // accuracy event emitted
    expect(h.emit).toHaveBeenCalledWith(
      'field_corrected',
      expect.objectContaining({ documentId: 'doc-1' }),
      expect.objectContaining({ corrected: expect.any(Object) }),
    );
  });
});

/**
 * Hono app wiring — GET pages (SSR JSX) + POST action handlers. All data access is via
 * @ttr/core repos / the console's read helpers; every write path also emits a MetricEvent
 * (in the action handlers). Basic-Auth gates everything (POC).
 */
import { Hono } from 'hono';
import {
  documents,
  claims as claimsRepo,
  carriers as carriersRepo,
  drivers as driversRepo,
  getSignedUrl,
  query,
} from '@ttr/core';
import type { Document, Extraction, Filing, ExtractionFields } from '@ttr/core';

import { basicAuth } from './auth.js';
import { renderPage } from './layout.js';
import { computeGates } from './metrics.js';
import { buildStatement } from './statements.js';
import { listOnboarding, grantedButNoDocs } from './onboarding.js';

import { DashboardPage } from './pages/dashboard.js';
import { QueuePage } from './pages/queue.js';
import { DocumentPage } from './pages/document.js';
import { ClaimsPage } from './pages/claims.js';
import { ClaimPage } from './pages/claim.js';
import { StatementPage } from './pages/statement.js';
import { UploadPage } from './pages/upload.js';
import { OnboardingPage } from './pages/onboarding.js';

import { correctDocument, validateDocument, addToClaim } from './actions/documents.js';
import { createClaim, updateClaim, fileClaim } from './actions/claims.js';
import { bulkUpload } from './actions/upload.js';
import { createOnboarding, recordAuthorization } from './actions/onboarding.js';
import { recordWtp } from './actions/wtp.js';

export function createApp(): Hono {
  const app = new Hono();

  // Unauthenticated health check (for container / uptime probes).
  app.get('/healthz', (c) => c.json({ ok: true, service: 'ttr-console' }));

  // Everything else requires the shared Basic-Auth credential (POC).
  app.use('*', basicAuth);

  // ---- GET / — gate dashboard ----
  app.get('/', async (c) => {
    const [g, carriers] = await Promise.all([computeGates(), carriersRepo.list()]);
    return c.html(await renderPage(<DashboardPage g={g} carriers={carriers} />));
  });
  app.post('/wtp', recordWtp);

  // ---- GET /queue — review queue ----
  app.get('/queue', async (c) => {
    const rows = await documents.listForReview();
    return c.html(await renderPage(<QueuePage rows={rows} />));
  });

  // ---- GET /documents/:id — side-by-side review ----
  app.get('/documents/:id', async (c) => {
    const doc = await documents.get(c.req.param('id'));
    if (!doc) return c.notFound();
    let imageUrl: string | null = null;
    try {
      imageUrl = await getSignedUrl(doc.r2_key);
    } catch {
      imageUrl = null; // offline / no object store — render without the image
    }
    // Claims the doc can be attached to (not-yet-filed).
    const allClaims = await claimsRepo.list();
    const openClaims = allClaims.filter((cl) => cl.status !== 'filed');
    const carriers = await carriersRepo.list();
    return c.html(
      await renderPage(
        <DocumentPage doc={doc} imageUrl={imageUrl} claims={openClaims} carriers={carriers} />,
      ),
    );
  });
  app.post('/documents/:id/correct', correctDocument);
  app.post('/documents/:id/validate', validateDocument);
  app.post('/documents/:id/add-to-claim', addToClaim);

  // ---- GET /claims — list + create ----
  app.get('/claims', async (c) => {
    const [claims, carriers] = await Promise.all([claimsRepo.list(), carriersRepo.list()]);
    return c.html(await renderPage(<ClaimsPage claims={claims} carriers={carriers} />));
  });
  app.post('/claims', createClaim);

  // ---- GET /claims/:id — assemble ----
  app.get('/claims/:id', async (c) => {
    const id = c.req.param('id');
    const claim = await claimsRepo.get(id);
    if (!claim) return c.notFound();
    const carrier = claim.carrier_id ? await carriersRepo.get(claim.carrier_id) : null;

    const docRows: Array<Document & { extraction: Extraction | null }> = [];
    for (const docId of claim.document_ids) {
      const d = await documents.get(docId);
      if (d) docRows.push(d);
    }
    // Convenience VAT sum (helper only — recoverable € stays manual).
    const vatSum = docRows.reduce((acc, d) => {
      const f: ExtractionFields = d.extraction?.corrected_fields ?? d.extraction?.fields ?? {};
      return acc + (typeof f.vat === 'number' ? f.vat : 0);
    }, 0);

    const filingRows = await query<Filing>(
      `select * from filing where claim_id = $1 order by submitted_at desc nulls last limit 1`,
      [id],
    );
    return c.html(
      await renderPage(
        <ClaimPage
          claim={claim}
          carrier={carrier}
          docs={docRows}
          vatSum={vatSum}
          filing={filingRows[0] ?? null}
        />,
      ),
    );
  });
  app.post('/claims/:id', updateClaim);
  app.post('/claims/:id/file', fileClaim);

  // ---- GET /statements/:driverId — per-driver recovery statement ----
  app.get('/statements/:driverId', async (c) => {
    const s = await buildStatement(c.req.param('driverId'));
    if (!s) return c.notFound();
    return c.html(await renderPage(<StatementPage s={s} />));
  });

  // ---- GET/POST /upload — backlog bulk upload ----
  app.get('/upload', async (c) => {
    const [drivers, carriers] = await Promise.all([driversRepo.list(), carriersRepo.list()]);
    const uploaded = Number(c.req.query('uploaded') ?? '') || undefined;
    return c.html(
      await renderPage(<UploadPage drivers={drivers} carriers={carriers} uploaded={uploaded} />),
    );
  });
  app.post('/upload', bulkUpload);

  // ---- GET/POST /onboarding — signup + authorization board ----
  app.get('/onboarding', async (c) => {
    const rows = await listOnboarding();
    const nudges = grantedButNoDocs(rows);
    return c.html(
      await renderPage(
        <OnboardingPage rows={rows} nudges={nudges} created={c.req.query('created')} />,
      ),
    );
  });
  app.post('/onboarding', createOnboarding);
  app.post('/onboarding/authorization', recordAuthorization);

  return app;
}

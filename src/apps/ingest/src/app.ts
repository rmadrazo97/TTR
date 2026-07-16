/**
 * The Hono app (routes only) — portable Node now, Cloudflare Worker later.
 *
 * `app.ts` owns HTTP concerns: parse the JSON body, delegate to the transport-agnostic
 * {@link handleInbound}, map the outcome to a status + JSON. All business logic + I/O
 * lives in `handlers/inbound.ts` and the @ttr/core deps wired in `defaultDeps()`.
 *
 * Import ONLY from '@ttr/core' (the single shared contract) — no direct pg/S3/SMTP here.
 */
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  loadConfig,
  drivers,
  documents,
  metrics,
  putObject,
  sendAck,
  query,
  type Config,
} from '@ttr/core';
import { handleInbound, type InboundDeps } from './handlers/inbound.js';
import { health } from './handlers/health.js';

/**
 * Wire the real @ttr/core functions into the handler's dependency bundle. `countByDriver`
 * is the one primitive not on the `documents` repo barrel, so we implement it inline with
 * core's `query` (plain SQL, no ORM) — the driver_id index in init.sql makes it cheap.
 */
export function defaultDeps(): InboundDeps {
  return {
    drivers: { findByForwardingAddress: (addr) => drivers.findByForwardingAddress(addr) },
    documents: {
      insert: (doc) => documents.insert(doc),
      countByDriver: async (driverId) => {
        const rows = await query<{ n: string }>(
          `select count(*)::text as n from document where driver_id = $1`,
          [driverId],
        );
        return Number(rows[0]?.n ?? 0);
      },
    },
    metrics: { emit: (type, refs, payload) => metrics.emit(type, refs, payload) },
    putObject: (key, body, contentType) => putObject(key, body, contentType),
    sendAck: (to, opts) => sendAck(to, opts),
  };
}

/**
 * Cap the inbound body size (pre-parse) to bound memory before we do any auth work.
 * 25 MiB max message (PRD 01) + base64 (~33%) + JSON framing → 30 MiB ceiling.
 */
const MAX_INBOUND_BYTES = 30 * 1024 * 1024;

/**
 * Build the Hono app. `cfg`/`deps` are injectable so tests can drive the routes with
 * mocks and never touch a real DB/S3/SMTP.
 */
export function createApp(cfg: Config = loadConfig(), deps: InboundDeps = defaultDeps()): Hono {
  const app = new Hono();

  // Liveness probe (FR: fast, no backing-service I/O).
  app.get('/health', (c) => c.json(health()));

  // The single ingestion surface (PRD 01 FR1–11).
  app.post('/inbound', async (c) => {
    // Reject oversized bodies before parsing (pre-auth memory guard).
    const declaredLen = Number(c.req.header('content-length'));
    if (Number.isFinite(declaredLen) && declaredLen > MAX_INBOUND_BYTES) {
      return c.json({ error: 'payload too large' }, 413);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'body must be valid JSON' }, 400);
    }
    const outcome = await handleInbound(raw, cfg, deps);
    return c.json(outcome.body, outcome.status as ContentfulStatusCode);
  });

  return app;
}

export default createApp;

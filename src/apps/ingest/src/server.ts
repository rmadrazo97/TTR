/**
 * Node entrypoint for the ingest app. Serves the Hono app on port 8787 via
 * @hono/node-server. In prod this same `app` deploys unchanged to a Cloudflare Worker
 * (Hono is portable); only this thin Node adapter is Node-specific.
 *
 * Run: `npm start` (from apps/ingest) or `tsx src/server.ts`.
 */
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const PORT = Number(process.env.INGEST_PORT ?? 8787);

const app = createApp();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`[@ttr/ingest] listening on http://localhost:${info.port}  (POST /inbound, GET /health)`);
});

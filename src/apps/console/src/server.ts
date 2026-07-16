/**
 * Console server entry — serves the Hono app on :3000 (PRD 04). Run with `tsx`.
 *
 *   npm -w @ttr/console run start     # or: PORT=3000 tsx src/server.ts
 *
 * Shared-password Basic-Auth (CONSOLE_USER / CONSOLE_PASSWORD env, dev defaults). All
 * data via @ttr/core against the same Postgres / R2 the ingest + extraction workers use.
 */
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`[@ttr/console] listening on http://localhost:${info.port}`);
});

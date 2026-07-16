/**
 * Extraction worker entrypoint (PRD 02).
 *
 * A long-running poller: it repeatedly claims the oldest `received` document
 * (FOR UPDATE SKIP LOCKED, so many workers can run) and drives it through the
 * extraction pipeline in {@link process}. When the queue is empty it idles for a
 * short interval, then polls again. Run: `tsx src/index.ts` (or `npm start`).
 *
 * The default extractor is a deterministic MOCK (EXTRACTION_MOCK=true) so the whole
 * pipeline runs offline with no LLM key. Flip EXTRACTION_MOCK=false (+ LLM_API_KEY)
 * to swap in the real vision extractor behind the same interface.
 */
import { pathToFileURL } from 'node:url';
import { loadConfig, closePool } from '@ttr/core';
import { processOnce, defaultDeps } from './process.js';
import type { ProcessDeps, ProcessOutcome } from './process.js';

/** How long to idle when the queue is empty before polling again (ms). */
function idleIntervalMs(): number {
  const n = Number.parseInt(process.env.WORKER_IDLE_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}
const IDLE_INTERVAL_MS = idleIntervalMs();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll forever: drain the queue as fast as documents appear, idle when empty. Stops
 * cleanly when `signal.aborted` flips (SIGINT/SIGTERM). Exported for tests/embedding.
 */
export async function runLoop(deps: ProcessDeps, signal: { aborted: boolean }): Promise<void> {
  deps.log('info', 'extraction worker started', {
    mock: loadConfig().extractionMock,
    idleMs: IDLE_INTERVAL_MS,
  });
  while (!signal.aborted) {
    let outcome: ProcessOutcome;
    try {
      outcome = await processOnce(deps);
    } catch (err) {
      // A crash in the claim step itself (e.g. DB blip) — log, back off, keep polling.
      deps.log('error', 'poll iteration crashed', {
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(IDLE_INTERVAL_MS);
      continue;
    }
    // Idle only when there was nothing to do; otherwise loop immediately to drain.
    if (outcome.status === 'idle') {
      await sleep(IDLE_INTERVAL_MS);
    }
  }
  deps.log('info', 'extraction worker stopped', {});
}

async function main(): Promise<void> {
  const deps = defaultDeps();
  const control = { aborted: false };

  const stop = (sig: string) => {
    deps.log('info', 'shutdown signal received', { signal: sig });
    control.aborted = true;
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  try {
    await runLoop(deps, control);
  } finally {
    await closePool();
  }
}

// Only run the loop when invoked directly (not when imported by tests).
const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'fatal', msg: 'worker crashed', error: String(err) }));
    process.exitCode = 1;
  });
}

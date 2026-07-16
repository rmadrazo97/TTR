/**
 * WTP (willingness-to-pay) capture action (PRD 06 §5.4). Logs a carrier's fee-acceptance
 * interview outcome as a `wtp_response` metric event — the source for the G4 gate number.
 */
import type { Context } from 'hono';
import { metrics } from '@ttr/core';
import { nullIfBlank } from '../fmt.js';

/** POST /wtp — record one fee-acceptance interview outcome. */
export async function recordWtp(c: Context): Promise<Response> {
  const form = await c.req.parseBody();
  const carrierId = nullIfBlank(form['carrier_id'] as string);
  if (!carrierId) return c.redirect('/');

  const accepted = form['accepted'] === 'true';
  await metrics.emit(
    'wtp_response',
    { carrierId },
    {
      accepted,
      fee_pct: nullIfBlank(form['fee_pct'] as string),
      note: nullIfBlank(form['note'] as string),
    },
  );
  return c.redirect('/');
}

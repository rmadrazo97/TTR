/**
 * GET /queue — the review queue (PRD 04 §5.2). Documents `ready_for_review` AND
 * `extraction_failed`, lowest overall confidence first (the repo already sorts this
 * way; failed docs — no confidence — sort to the top and are never dropped). Each row
 * links to the side-by-side review form; failed docs open a blank manual-entry form.
 */
import { Layout, StatusPill } from '../layout.js';
import { eur, pct, shortDate, confBucket } from '../fmt.js';
import type { Document, Extraction } from '@ttr/core';

type Row = Document & { extraction: Extraction | null };

function confTone(v: number | null | undefined): 'good' | 'amber' | 'bad' | 'gray' {
  switch (confBucket(v)) {
    case 'high':
      return 'good';
    case 'mid':
      return 'amber';
    case 'low':
      return 'bad';
    default:
      return 'gray';
  }
}

export function QueuePage({ rows }: { rows: Row[] }) {
  return (
    <Layout title="Cola de revisión">
      <h1>Cola de revisión ({rows.length})</h1>
      <p class="sub">
        Menor confianza primero. Los <strong>fallidos</strong> abren un formulario en blanco de
        entrada manual — nunca se descartan.
      </p>
      <table>
        <thead>
          <tr>
            <th>Estado</th>
            <th>Confianza</th>
            <th>Proveedor</th>
            <th>VAT-ID</th>
            <th>Fecha</th>
            <th>Bruto</th>
            <th>IVA</th>
            <th>Origen</th>
            <th>Recibido</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colspan={10} class="muted">
                Nada pendiente de revisión.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const failed = r.status === 'extraction_failed';
            const conf = r.extraction?.confidence?.overall ?? null;
            const f = r.extraction?.fields ?? null;
            return (
              <tr>
                <td>
                  {failed ? (
                    <StatusPill tone="bad">fallido</StatusPill>
                  ) : (
                    <StatusPill tone="amber">por revisar</StatusPill>
                  )}
                </td>
                <td>
                  {failed ? (
                    <span class="muted">—</span>
                  ) : (
                    <StatusPill tone={confTone(conf)}>{pct(conf)}</StatusPill>
                  )}
                </td>
                <td>{f?.supplier ?? <span class="muted">—</span>}</td>
                <td>{f?.vatId ?? <span class="muted">—</span>}</td>
                <td>{f?.date ?? <span class="muted">—</span>}</td>
                <td>{f?.gross != null ? eur(f.gross) : <span class="muted">—</span>}</td>
                <td>{f?.vat != null ? eur(f.vat) : <span class="muted">—</span>}</td>
                <td>{r.source}</td>
                <td>{shortDate(r.received_at)}</td>
                <td>
                  <a href={`/documents/${r.id}`}>{failed ? 'entrada manual →' : 'revisar →'}</a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Layout>
  );
}

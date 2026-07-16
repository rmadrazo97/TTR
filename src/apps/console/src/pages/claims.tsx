/**
 * GET /claims — list all claims + a create form (PRD 04 §5.5). A claim groups validated
 * documents under a carrier with a type + disposition; the asesor enters the recoverable
 * € manually and moves it draft → ready|blocked → filed.
 */
import { Layout, StatusPill } from '../layout.js';
import { eur, shortDate } from '../fmt.js';
import type { Claim, Carrier } from '@ttr/core';

function statusTone(s: string): 'good' | 'amber' | 'bad' | 'gray' {
  if (s === 'filed') return 'good';
  if (s === 'ready') return 'amber';
  if (s === 'blocked') return 'bad';
  return 'gray';
}

export function ClaimsPage({ claims, carriers }: { claims: Claim[]; carriers: Carrier[] }) {
  const carrierName = (id: string | null) =>
    carriers.find((c) => c.id === id)?.legal_name ?? id ?? '—';
  return (
    <Layout title="Reclamaciones">
      <h1>Reclamaciones ({claims.length})</h1>
      <p class="sub">
        El POC presenta <code>foreign_vat</code> (disposition <code>file</code>);{' '}
        <code>gasoleo→assure</code>, <code>excise/dietas→identify_only</code>.
      </p>

      <table>
        <thead>
          <tr>
            <th>Carrier</th>
            <th>Tipo</th>
            <th>Disposición</th>
            <th>País</th>
            <th>Periodo</th>
            <th>Docs</th>
            <th>€ recuperable</th>
            <th>Min. asesor</th>
            <th>Estado</th>
            <th>Creada</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {claims.length === 0 && (
            <tr>
              <td colspan={11} class="muted">
                Sin reclamaciones todavía.
              </td>
            </tr>
          )}
          {claims.map((cl) => (
            <tr>
              <td>{carrierName(cl.carrier_id)}</td>
              <td>{cl.type}</td>
              <td>{cl.disposition}</td>
              <td>{cl.country ?? '—'}</td>
              <td>{cl.period ?? '—'}</td>
              <td>{cl.document_ids.length}</td>
              <td>{eur(cl.recoverable_eur)}</td>
              <td>{cl.asesor_minutes ?? '—'}</td>
              <td>
                <StatusPill tone={statusTone(cl.status)}>{cl.status}</StatusPill>
                {cl.status === 'blocked' && cl.blocked_reason ? (
                  <div class="muted" style="font-size:12px">
                    {cl.blocked_reason}
                  </div>
                ) : null}
              </td>
              <td>{shortDate(cl.created_at)}</td>
              <td>
                <a href={`/claims/${cl.id}`}>abrir →</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Nueva reclamación</h2>
      <div class="card">
        <form method="post" action="/claims">
          <div class="row">
            <div class="col">
              <label>Carrier</label>
              <select name="carrier_id" required>
                <option value="">—</option>
                {carriers.map((c) => (
                  <option value={c.id}>{c.legal_name}</option>
                ))}
              </select>
            </div>
            <div class="col">
              <label>Tipo</label>
              <select name="type">
                <option value="foreign_vat">foreign_vat</option>
                <option value="excise">excise</option>
                <option value="dietas">dietas</option>
              </select>
            </div>
            <div class="col">
              <label>Disposición</label>
              <select name="disposition">
                <option value="file">file (presentar)</option>
                <option value="assure">assure (asegurar)</option>
                <option value="identify_only">identify_only (identificar)</option>
              </select>
            </div>
          </div>
          <div class="row">
            <div class="col">
              <label>País (opcional)</label>
              <input type="text" name="country" placeholder="FR" />
            </div>
            <div class="col">
              <label>Periodo (opcional)</label>
              <input type="text" name="period" placeholder="2026-Q2" />
            </div>
          </div>
          <button type="submit" style="margin-top:10px">
            Crear reclamación
          </button>
        </form>
      </div>
    </Layout>
  );
}

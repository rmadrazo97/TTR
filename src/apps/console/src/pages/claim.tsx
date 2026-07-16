/**
 * GET /claims/:id — assemble one claim (PRD 04 §5.5–5.6).
 *  - Lists the attached documents with a convenience SUM of their VAT amounts (helper
 *    only — the recoverable € stays a manual entry; we don't build the rules engine).
 *  - Edit: recoverable_eur, asesor_minutes (cost-to-serve input), status ready/blocked
 *    (+reason).
 *  - Record filing: form (modelo_360), method (colaboracion_social), AEAT reference →
 *    claim.filed + Filing row + claim_filed metric.
 */
import { Layout, StatusPill } from '../layout.js';
import { eur, shortDate } from '../fmt.js';
import type { Claim, Carrier, Document, Extraction, Filing, ExtractionFields } from '@ttr/core';

type DocRow = Document & { extraction: Extraction | null };

function statusTone(s: string): 'good' | 'amber' | 'bad' | 'gray' {
  if (s === 'filed') return 'good';
  if (s === 'ready') return 'amber';
  if (s === 'blocked') return 'bad';
  return 'gray';
}

export function ClaimPage({
  claim,
  carrier,
  docs,
  vatSum,
  filing,
}: {
  claim: Claim;
  carrier: Carrier | null;
  docs: DocRow[];
  vatSum: number;
  filing: Filing | null;
}) {
  const isFiled = claim.status === 'filed';
  return (
    <Layout title={`Reclamación ${claim.id.slice(0, 8)}`}>
      <h1>
        Reclamación <StatusPill tone={statusTone(claim.status)}>{claim.status}</StatusPill>
      </h1>
      <p class="sub">
        <code>{claim.id}</code> · {carrier?.legal_name ?? '—'} · {claim.type} / {claim.disposition}{' '}
        · {claim.country ?? '—'} · {claim.period ?? '—'} · creada {shortDate(claim.created_at)}
      </p>

      <h2>Documentos ({docs.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Proveedor</th>
            <th>VAT-ID</th>
            <th>Fecha</th>
            <th>Bruto</th>
            <th>IVA</th>
            <th>Estado doc</th>
          </tr>
        </thead>
        <tbody>
          {docs.length === 0 && (
            <tr>
              <td colspan={6} class="muted">
                Sin documentos. Añádelos desde <a href="/queue">la cola</a>.
              </td>
            </tr>
          )}
          {docs.map((d) => {
            const f: ExtractionFields = d.extraction?.corrected_fields ?? d.extraction?.fields ?? {};
            return (
              <tr>
                <td>{f.supplier ?? '—'}</td>
                <td>{f.vatId ?? '—'}</td>
                <td>{f.date ?? '—'}</td>
                <td>{f.gross != null ? eur(f.gross) : '—'}</td>
                <td>{f.vat != null ? eur(f.vat) : '—'}</td>
                <td>
                  <a href={`/documents/${d.id}`}>{d.status}</a>
                </td>
              </tr>
            );
          })}
          {docs.length > 0 && (
            <tr>
              <td colspan={4}>
                <strong>Suma de IVA (conveniencia — no es el € recuperable)</strong>
              </td>
              <td colspan={2}>
                <strong>{eur(vatSum)}</strong>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div class="split" style="margin-top:16px">
        <div class="card">
          <h2 style="margin-top:0">€ y estado</h2>
          <form method="post" action={`/claims/${claim.id}`}>
            <label>€ recuperable (manual)</label>
            <input
              type="number"
              step="0.01"
              name="recoverable_eur"
              value={claim.recoverable_eur ?? ''}
            />
            <label>Minutos de asesor (coste de servicio)</label>
            <input type="number" name="asesor_minutes" value={claim.asesor_minutes ?? ''} />
            <label>Estado</label>
            <select name="status">
              <option value="draft" selected={claim.status === 'draft'}>
                draft
              </option>
              <option value="ready" selected={claim.status === 'ready'}>
                ready
              </option>
              <option value="blocked" selected={claim.status === 'blocked'}>
                blocked
              </option>
            </select>
            <label>Motivo de bloqueo (si blocked)</label>
            <input type="text" name="blocked_reason" value={claim.blocked_reason ?? ''} />
            <button type="submit" style="margin-top:10px">
              Guardar
            </button>
          </form>
        </div>

        <div class="card">
          <h2 style="margin-top:0">Registrar presentación (modelo 360)</h2>
          {isFiled && filing ? (
            <div>
              <p>
                <StatusPill tone="good">presentada</StatusPill>
              </p>
              <table>
                <tbody>
                  <tr>
                    <th>Formulario</th>
                    <td>{filing.form}</td>
                  </tr>
                  <tr>
                    <th>Método</th>
                    <td>{filing.method}</td>
                  </tr>
                  <tr>
                    <th>Ref. AEAT</th>
                    <td>{filing.aeat_reference ?? '—'}</td>
                  </tr>
                  <tr>
                    <th>Presentado</th>
                    <td>{shortDate(filing.submitted_at)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <form method="post" action={`/claims/${claim.id}/file`}>
              <p class="muted" style="margin-top:0">
                Tras presentar el modelo 360 en AEAT (colaboración social), registra la referencia.
              </p>
              <label>Formulario</label>
              <input type="text" name="form" value="modelo_360" />
              <label>Método</label>
              <input type="text" name="method" value="colaboracion_social" />
              <label>Referencia AEAT</label>
              <input type="text" name="aeat_reference" placeholder="p. ej. 2026360XXXXXXX" required />
              <label>Presentado por</label>
              <input type="text" name="submitted_by" placeholder="asesor" />
              <button type="submit" style="margin-top:10px">
                Marcar presentada
              </button>
            </form>
          )}
        </div>
      </div>

      <p class="sub" style="margin-top:16px">
        <a href="/claims">← todas las reclamaciones</a>
        {carrier ? (
          <>
            {' '}
            · <a href={`/statements/${docs[0]?.driver_id ?? ''}`}>ver extracto del conductor</a>
          </>
        ) : null}
      </p>
    </Layout>
  );
}

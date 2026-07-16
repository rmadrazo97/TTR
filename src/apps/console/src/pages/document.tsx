/**
 * GET /documents/:id — the side-by-side review screen (PRD 04 §5.3–5.5).
 *
 *  - Left: the receipt image via a short-lived R2 signed URL.
 *  - Right: the editable 4-field form (vatId/date/gross/vat) — pre-filled from the
 *    extraction (or blank for extraction_failed → manual entry). Saving writes
 *    Extraction.corrected_fields + marks the document `reviewed` + emits field_corrected.
 *  - A MANUAL reconcile/validate block: a human-entered validity verdict, a VIES link
 *    (opened by hand — NOT automated), a gross=net+VAT sanity hint, date-in-window — all
 *    recorded as notes, none automated (PRD 04 §5.4 holds the line on the rules engine).
 *  - Add-to-claim: attach this document to an existing claim.
 */
import { Layout, StatusPill } from '../layout.js';
import { eur, pct, confBucket } from '../fmt.js';
import type { Document, Extraction, Claim, Carrier, ExtractionFields } from '@ttr/core';

type Doc = Document & { extraction: Extraction | null };

function vatSum(gross?: number, vat?: number): string {
  if (gross == null || vat == null) return '';
  const net = gross - vat;
  return `neto ≈ ${eur(net)} · bruto ${eur(gross)} = neto ${eur(net)} + IVA ${eur(vat)}`;
}

export function DocumentPage({
  doc,
  imageUrl,
  claims,
  carriers,
}: {
  doc: Doc;
  imageUrl: string | null;
  claims: Claim[];
  carriers: Carrier[];
}) {
  const failed = doc.status === 'extraction_failed';
  // Prefer already-corrected values, else the raw extraction, else blank.
  const src: ExtractionFields = doc.extraction?.corrected_fields ?? doc.extraction?.fields ?? {};
  const conf: Record<string, number> = doc.extraction?.confidence?.perField ?? {};
  const overall = doc.extraction?.confidence?.overall ?? null;
  const carrierName = (id: string | null) =>
    carriers.find((c) => c.id === id)?.legal_name ?? id ?? '—';

  const fieldRow = (name: 'vatId' | 'date' | 'gross' | 'vat', label: string, type: string) => {
    const bucket = confBucket(conf[name]);
    const tone = bucket === 'high' ? 'good' : bucket === 'mid' ? 'amber' : bucket === 'low' ? 'bad' : 'gray';
    const val = (src as Record<string, unknown>)[name];
    return (
      <div class="row" style="margin-bottom:6px; align-items:center">
        <div style="flex:0 0 90px">
          <label style="margin:0">{label}</label>
        </div>
        <div style="flex:1 1 auto">
          <input
            type={type}
            name={name}
            step={type === 'number' ? '0.01' : undefined}
            value={val == null ? '' : String(val)}
          />
        </div>
        <div style="flex:0 0 70px">
          {failed ? <span class="muted">—</span> : <StatusPill tone={tone}>{pct(conf[name])}</StatusPill>}
        </div>
      </div>
    );
  };

  return (
    <Layout title={`Documento ${doc.id.slice(0, 8)}`}>
      <h1>
        Revisión de documento{' '}
        {failed ? (
          <StatusPill tone="bad">extracción fallida — entrada manual</StatusPill>
        ) : (
          <StatusPill tone={doc.status === 'reviewed' ? 'good' : 'amber'}>{doc.status}</StatusPill>
        )}
      </h1>
      <p class="sub">
        <code>{doc.id}</code> · origen {doc.source} · confianza global{' '}
        {failed ? '—' : pct(overall)}
      </p>

      <div class="split">
        <div class="imgwrap">
          {imageUrl ? (
            <img src={imageUrl} alt="recibo" />
          ) : (
            <p class="muted">Sin imagen disponible (URL firmada no generada).</p>
          )}
          <p class="muted" style="margin:6px 2px 0; font-size:12px">
            Imagen vía URL firmada de corta duración (R2, jurisdicción EU).
          </p>
        </div>

        <div>
          <div class="card">
            <h2 style="margin-top:0">Campos (4) · corregir y confirmar</h2>
            <form method="post" action={`/documents/${doc.id}/correct`}>
              {fieldRow('vatId', 'VAT-ID', 'text')}
              {fieldRow('date', 'Fecha', 'date')}
              {fieldRow('gross', 'Bruto €', 'number')}
              {fieldRow('vat', 'IVA €', 'number')}
              <div class="note" style="margin:8px 0">
                Comprobación bruto = neto + IVA (manual): {vatSum(src.gross, src.vat) || '—'}
              </div>
              <button type="submit">Guardar corrección y marcar revisado</button>
            </form>
          </div>

          <div class="card" style="margin-top:14px">
            <h2 style="margin-top:0">Reconciliar y validar (manual)</h2>
            <p class="muted" style="margin-top:0">
              Verificaciones humanas — NO automatizadas. Se guardan como notas del documento.
            </p>
            <form method="post" action={`/documents/${doc.id}/validate`}>
              <label>Veredicto de validez</label>
              <select name="verdict">
                <option value="">—</option>
                <option value="valid">Válido</option>
                <option value="blocked">Bloqueado</option>
              </select>
              <label>Comprobaciones (marcar las hechas a mano)</label>
              <div class="row">
                <label class="col" style="font-weight:400">
                  <input type="checkbox" name="check_vies" style="width:auto" /> VAT-ID en VIES
                </label>
                <label class="col" style="font-weight:400">
                  <input type="checkbox" name="check_sum" style="width:auto" /> bruto = neto + IVA
                </label>
                <label class="col" style="font-weight:400">
                  <input type="checkbox" name="check_window" style="width:auto" /> fecha en ventana
                </label>
                <label class="col" style="font-weight:400">
                  <input type="checkbox" name="check_category" style="width:auto" /> categoría elegible
                </label>
              </div>
              <p style="margin:8px 0 4px">
                <a
                  href={`https://ec.europa.eu/taxation_customs/vies/#/vat-validation`}
                  target="_blank"
                  rel="noopener"
                >
                  Abrir VIES para verificar {src.vatId ? <code>{src.vatId}</code> : 'el VAT-ID'} (manual)
                </a>
              </p>
              <label>Notas / motivo de bloqueo</label>
              <textarea name="notes" placeholder="p. ej. VAT-ID no válido en VIES; fuera de ventana…"></textarea>
              <button type="submit" class="sec" style="margin-top:8px">
                Guardar veredicto
              </button>
            </form>
          </div>

          <div class="card" style="margin-top:14px">
            <h2 style="margin-top:0">Añadir a reclamación</h2>
            {claims.length === 0 ? (
              <p class="muted">
                No hay reclamaciones. <a href="/claims">Crear una →</a>
              </p>
            ) : (
              <form method="post" action={`/documents/${doc.id}/add-to-claim`}>
                <label>Reclamación</label>
                <select name="claim_id">
                  {claims.map((cl) => (
                    <option value={cl.id}>
                      {carrierName(cl.carrier_id)} · {cl.type} · {cl.status} ·{' '}
                      {cl.document_ids.length} docs
                    </option>
                  ))}
                </select>
                <button type="submit" class="sec" style="margin-top:8px">
                  Añadir documento
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <p class="sub" style="margin-top:16px">
        <a href="/queue">← volver a la cola</a>
      </p>
    </Layout>
  );
}

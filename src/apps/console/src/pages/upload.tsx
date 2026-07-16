/**
 * GET /upload — backlog bulk upload (PRD 04 §5.9). The asesor uploads a carrier's
 * historical fuel-card monthly invoices / receipts (multi-file) → Document rows with
 * source='asesor_upload', status='received' → they enter the same extraction queue.
 * This is how the pilot recovers ~12 months of € before 30-Sep, not one email at a time.
 */
import { Layout } from '../layout.js';
import type { Driver, Carrier } from '@ttr/core';

export function UploadPage({
  drivers,
  carriers,
  uploaded,
}: {
  drivers: Driver[];
  carriers: Carrier[];
  uploaded?: number;
}) {
  const carrierName = (id: string | null) =>
    carriers.find((c) => c.id === id)?.legal_name ?? '';
  return (
    <Layout title="Subir backlog">
      <h1>Subir backlog histórico</h1>
      <p class="sub">
        Facturas/recibos mensuales de tarjeta de combustible → documentos{' '}
        <code>asesor_upload</code> · estado <code>received</code> → misma cola de extracción.
      </p>

      {uploaded ? (
        <div class="note" style="margin-bottom:12px">
          Subidos {uploaded} documento(s). Ya están en la <a href="/queue">cola</a> para extracción.
        </div>
      ) : null}

      <div class="card">
        <form method="post" action="/upload" enctype="multipart/form-data">
          <label>Conductor (destino de los documentos)</label>
          <select name="driver_id" required>
            <option value="">—</option>
            {drivers.map((d) => (
              <option value={d.id}>
                {d.name ?? d.forwarding_address}
                {d.carrier_id ? ` · ${carrierName(d.carrier_id)}` : ''}
              </option>
            ))}
          </select>
          <label>Archivos (múltiples)</label>
          <input type="file" name="files" multiple />
          <button type="submit" style="margin-top:12px">
            Subir a la cola
          </button>
        </form>
        <p class="muted" style="font-size:12px; margin-bottom:0">
          Cada archivo se almacena en R2 (EU) y se crea un <code>Document</code>. La extracción la
          recoge el worker (MOCK offline si <code>EXTRACTION_MOCK=true</code>).
        </p>
      </div>
    </Layout>
  );
}

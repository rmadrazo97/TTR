/**
 * Backlog bulk-upload action (PRD 04 §5.9). Multi-file → each file is stored in R2 and
 * a Document row is created with source='asesor_upload', status='received', so it enters
 * the same extraction queue the forwarded emails do.
 *
 * Object key follows the storage convention (PRD 01/03):
 *   receipts/{driver_id}/{yyyy}/{mm}/{message_id}-{n}.{ext}
 * `message_id` is synthesised per upload batch so the (message_id, attachment_index)
 * dedup key stays meaningful.
 */
import type { Context } from 'hono';
import { documents, drivers, putObject, metrics, query } from '@ttr/core';

function extFor(name: string, mime: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  if (m) return m[1]!.toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'bin';
}

/** POST /upload — store each uploaded file and create a received Document. */
export async function bulkUpload(c: Context): Promise<Response> {
  const form = await c.req.parseBody({ all: true });
  const driverId = typeof form['driver_id'] === 'string' ? form['driver_id'] : '';
  if (!driverId) return c.redirect('/upload');

  const driver = await drivers.get(driverId);
  if (!driver) return c.notFound();

  // `all: true` yields an array when multiple files share the name "files".
  const raw = form['files'];
  const files = (Array.isArray(raw) ? raw : [raw]).filter(
    (f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f,
  );

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const messageId = `asesor-upload-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;

  // Whether the driver already had any documents before this batch — so
  // `first_doc_received` fires at most once, on the driver's genuine first doc.
  const prior = await query<{ n: string }>(
    `select count(*)::text as n from document where driver_id = $1`,
    [driverId],
  );
  let driverHadDocs = Number(prior[0]?.n ?? 0) > 0;

  let uploaded = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    if (!file.name && file.size === 0) continue;
    const mime = file.type || 'application/octet-stream';
    const ext = extFor(file.name, mime);
    const key = `receipts/${driverId}/${yyyy}/${mm}/${messageId}-${i}.${ext}`;
    const body = Buffer.from(await file.arrayBuffer());

    await putObject(key, body, mime);
    const { document, created } = await documents.insert({
      driver_id: driverId,
      r2_key: key,
      message_id: messageId,
      attachment_index: i,
      subject: file.name || `backlog-${i}`,
      mime,
      size_bytes: body.length,
      source: 'asesor_upload',
      status: 'received',
    });
    if (created) {
      uploaded++;
      // First-ever doc for this driver? mirror the ingest first_doc_received signal
      // (fires once). Guards the G2 "granted AND sent >=1 doc" numerator.
      if (!driverHadDocs) {
        driverHadDocs = true;
        await metrics.emit('first_doc_received', {
          documentId: document.id,
          driverId,
          carrierId: driver.carrier_id ?? undefined,
        });
      }
    }
  }

  return c.redirect(`/upload?uploaded=${uploaded}`);
}

/**
 * Bilingual (ES first, EN second) driver-facing message bodies (PRD 01 FR8/FR10/FR11).
 * Spanish leads because the driver is a non-digital-native Spanish micro-carrier
 * (dossier §8). These are the ONLY outbound emails the POC sends — a receipt ack, an
 * unknown-address nudge, and a partial-rejection note appended to the ack.
 */
import type { AckOptions } from '@ttr/core';
import type { AttachmentRejectReason } from './attachments.js';

/** "✅ Recibido" ack for one or more stored attachments (FR8). */
export function ackReceived(storedCount: number, rejected: RejectedSummary[]): AckOptions {
  const doc = storedCount === 1 ? 'documento' : 'documentos';
  const en = storedCount === 1 ? 'document' : 'documents';
  let textBody =
    `✅ Recibido — hemos guardado ${storedCount} ${doc} y lo estamos procesando.\n` +
    `No hace falta que respondas a este correo.\n\n` +
    `✅ Received — we stored ${storedCount} ${en} and are processing ${storedCount === 1 ? 'it' : 'them'}.\n` +
    `No reply is needed.`;
  if (rejected.length > 0) {
    textBody += `\n\n${rejectionNote(rejected)}`;
  }
  return { subject: '✅ Recibido / Received — TTR', textBody };
}

/**
 * Reply/bounce for a mail whose `To:` isn't a registered driver address (FR10). Sent to
 * the original sender so a mistyped address gets human guidance, not silence.
 */
export function unknownAddress(recipient: string): AckOptions {
  const textBody =
    `Esta dirección (${recipient}) no está registrada en TTR. ` +
    `Por favor comprueba la dirección o contacta con TTR.\n\n` +
    `This address (${recipient}) is not registered with TTR. ` +
    `Please check the address or contact TTR.`;
  return { subject: 'Dirección no registrada / Address not registered — TTR', textBody };
}

/** Ack when nothing could be stored (all attachments rejected, or none present). */
export function nothingStored(rejected: RejectedSummary[]): AckOptions {
  // Special case: the email had no attachments at all — give a clear prompt instead of
  // an empty bullet list which is confusing for non-digital-native drivers (PRD 01 FR4/FR11).
  if (rejected.length === 0) {
    const textBody =
      `No encontramos ningún archivo adjunto en tu correo. ` +
      `Por favor reenvía el correo con la factura adjunta como PDF, JPG o PNG.\n\n` +
      `We found no attachment in your email. ` +
      `Please forward the email again with the invoice attached as a PDF, JPG, or PNG.\n\n` +
      `El equipo de TTR te escribirá para ayudarte. / The TTR team will contact you to help.`;
    return { subject: 'No pudimos procesar tu correo / Could not process — TTR', textBody };
  }
  const textBody =
    `No pudimos guardar ningún documento de tu correo.\n${rejectionNote(rejected)}\n\n` +
    `We could not store any document from your email.\n` +
    `${rejectionNoteEn(rejected)}\n\n` +
    `El equipo de TTR te escribirá para ayudarte a reenviarlo. / The TTR team will contact you to help you resend it.`;
  return { subject: 'No pudimos procesar tu correo / Could not process — TTR', textBody };
}

export interface RejectedSummary {
  filename: string;
  reason: AttachmentRejectReason;
}

const REASON_ES: Record<AttachmentRejectReason, string> = {
  bad_mime: 'tipo de archivo no admitido (solo JPG, PNG o PDF)',
  empty: 'archivo vacío',
  oversize: 'archivo demasiado grande (límite 25 MiB por correo)',
};

const REASON_EN: Record<AttachmentRejectReason, string> = {
  bad_mime: 'unsupported file type (only JPG, PNG or PDF)',
  empty: 'empty file',
  oversize: 'file too large (25 MiB per-email limit)',
};

function rejectionNote(rejected: RejectedSummary[]): string {
  const lines = rejected.map((r) => `  • ${r.filename}: ${REASON_ES[r.reason]}`);
  const hasOversize = rejected.some((r) => r.reason === 'oversize');
  const tip = hasOversize
    ? '\nConsejo: envía menos fotos por correo. Las facturas PDF de varias páginas de tarjeta de combustible sí se aceptan enteras.'
    : '';
  return `No se pudieron guardar estos archivos:\n${lines.join('\n')}${tip}`;
}

function rejectionNoteEn(rejected: RejectedSummary[]): string {
  const lines = rejected.map((r) => `  • ${r.filename}: ${REASON_EN[r.reason]}`);
  return `These files could not be stored:\n${lines.join('\n')}`;
}

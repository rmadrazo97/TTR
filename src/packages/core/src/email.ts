/**
 * Outbound email via nodemailer SMTP. Locally this points at Mailpit (SMTP 1025,
 * UI 8025) so acks are viewable without sending real mail; in prod it's the
 * provider's SMTP relay. The POC only sends the bilingual "recibido" acknowledgement
 * (PRD 01 FR8) — no other outbound correspondence.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { loadConfig } from './config.js';

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!transporter) {
    const { smtp } = loadConfig();
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      // Mailpit (and most dev relays) speak plain SMTP with no auth/TLS.
      secure: false,
      ignoreTLS: true,
    });
  }
  return transporter;
}

/** From address for acknowledgements. Overridable via ACK_FROM. */
function ackFrom(): string {
  return process.env.ACK_FROM ?? 'TTR <recibos@ingest.ttr.example>';
}

export interface AckOptions {
  subject: string;
  textBody: string;
}

/**
 * Send a receipt acknowledgement to a driver. Thin wrapper over nodemailer so the
 * ingest app has a one-liner and callers never touch transport config directly.
 */
export async function sendAck(to: string, opts: AckOptions): Promise<void> {
  await getTransporter().sendMail({
    from: ackFrom(),
    to,
    subject: opts.subject,
    text: opts.textBody,
  });
}

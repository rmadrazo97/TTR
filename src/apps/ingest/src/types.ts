/**
 * Internal, provider-neutral shapes for the ingest app.
 *
 * The inbound edge (a Mailgun-EU / Postmark *parse webhook*, or a future Cloudflare
 * `email()` handler) is deliberately kept behind a thin normalization seam (PRD 01 §6):
 * every provider payload is coerced into {@link InboundEmail} before any business logic
 * runs, so swapping the receiving edge is a localized change, not a rewrite.
 */

/** A single decoded attachment, normalized from any provider shape. */
export interface InboundAttachment {
  /** Original filename as sent by the driver's mail client. Preserved as object metadata. */
  filename: string;
  /** MIME type declared by the provider (validated against the allowlist downstream). */
  contentType: string;
  /** Base64-encoded bytes of the attachment (the provider pre-decodes MIME for us). */
  contentBase64: string;
}

/** Provider-authentication verdicts, when the provider supplies them (may be null). */
export interface AuthVerdicts {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}

/**
 * The normalized inbound email the handler operates on. Field names are the union of
 * what PRD 01 needs; both the task's camelCase contract and the repo's snake_case
 * fixture map onto this via {@link normalizeInbound}.
 */
export interface InboundEmail {
  /** 'mailgun_eu' | 'postmark' | 'cloudflare' — informational; verification is uniform. */
  provider: string;
  /** `From:` — the driver's actual mailbox; cross-checked against registered_email (FR7). */
  sender: string;
  /** `To:` — the secret per-driver forwarding address; the routing key (FR2). */
  recipient: string;
  subject: string;
  /** Raw `Message-ID`; the dedup key together with attachment_index (FR6). */
  messageId: string;
  /** Provider-auth verdicts (FR7). Present under Mailgun/Postmark; null under Cloudflare. */
  auth: AuthVerdicts;
  attachments: InboundAttachment[];
  /**
   * The provider-supplied receipt timestamp (PRD 01 FR6). Used as the canonical
   * received_at for both the DB row and the R2 key partition so they agree even under
   * clock skew or retries. Normalized from `received_at` in the fixture or a current
   * timestamp when the provider does not supply one.
   */
  receivedAt: Date;
}

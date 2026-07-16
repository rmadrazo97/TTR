/**
 * Unit tests for the inbound normalization + signature-verification seam.
 *
 * Verifies BOTH supported schemes: the task's camelCase contract
 * (scheme-1: `HMAC(secret, `${timestamp}.${recipient}.${messageId}.${sender}.${attachmentHashes}`)`)
 * and the repo fixture's snake_case Mailgun-style scheme
 * (scheme-2: `HMAC(secret, `${timestamp}.${compactBody}`)`).
 * Also asserts the committed `fixtures/receipt.webhook.json` verifies unchanged so the
 * local pipeline keeps working (timestamp check skipped for frozen fixture).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  normalizeInbound,
  verifySignature,
  signTaskContract,
  TIMESTAMP_TOLERANCE_S,
  InvalidPayloadError,
} from '../webhook.js';

const SECRET = 'test-secret';

/** A fresh timestamp (Unix seconds) that will pass the recency check. */
function freshTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('normalizeInbound', () => {
  it('accepts the task camelCase contract', () => {
    const email = normalizeInbound({
      provider: 'mailgun_eu',
      sender: 'd@x.com',
      recipient: 'juan.perez@ingest.ttr.example',
      subject: 'factura',
      messageId: '<a@mail>',
      spf: 'pass',
      dkim: null,
      dmarc: 'fail',
      attachments: [{ filename: 'r.jpg', contentType: 'image/jpeg', contentBase64: 'AA==' }],
    });
    expect(email.sender).toBe('d@x.com');
    expect(email.recipient).toBe('juan.perez@ingest.ttr.example');
    expect(email.messageId).toBe('<a@mail>');
    expect(email.auth).toEqual({ spf: 'pass', dkim: null, dmarc: 'fail' });
    expect(email.attachments[0]).toEqual({
      filename: 'r.jpg',
      contentType: 'image/jpeg',
      contentBase64: 'AA==',
    });
  });

  it('accepts the repo snake_case fixture shape (from/to/message_id/content_*)', () => {
    const email = normalizeInbound({
      from: 'd@x.com',
      to: 'juan.perez@ingest.ttr.example',
      message_id: '<b@mail>',
      subject: 's',
      attachments: [{ filename: 'r.png', content_type: 'image/png', content_base64: 'AA==' }],
    });
    expect(email.sender).toBe('d@x.com');
    expect(email.recipient).toBe('juan.perez@ingest.ttr.example');
    expect(email.messageId).toBe('<b@mail>');
    expect(email.attachments[0]!.contentType).toBe('image/png');
    expect(email.attachments[0]!.contentBase64).toBe('AA==');
  });

  it('throws on a missing recipient or messageId', () => {
    expect(() => normalizeInbound({ messageId: '<x@m>' })).toThrow(InvalidPayloadError);
    expect(() => normalizeInbound({ recipient: 'x@y' })).toThrow(InvalidPayloadError);
    expect(() => normalizeInbound(null)).toThrow(InvalidPayloadError);
  });
});

describe('verifySignature — task contract / scheme-1 (camelCase, body-covering)', () => {
  const recipient = 'juan.perez@ingest.ttr.example';
  const messageId = '<c@mail>';
  const sender = 'driver@example.com';
  const attachments = [{ contentBase64: 'AA==' }];

  it('accepts a correctly signed payload (constant-time match)', () => {
    const timestamp = freshTs();
    const signature = signTaskContract(recipient, messageId, SECRET, { timestamp, sender, attachments });
    expect(verifySignature({ recipient, messageId, sender, attachments, timestamp, signature }, SECRET)).toBe(true);
  });

  it('rejects a tampered signature / wrong secret', () => {
    const timestamp = freshTs();
    const signature = signTaskContract(recipient, messageId, SECRET, { timestamp, sender, attachments });
    expect(
      verifySignature({ recipient, messageId, sender, attachments, timestamp, signature: 'deadbeef' }, SECRET),
    ).toBe(false);
    expect(
      verifySignature({ recipient, messageId, sender, attachments, timestamp, signature }, 'other-secret'),
    ).toBe(false);
  });

  it('rejects when attachments are swapped even with a valid signature for original', () => {
    const timestamp = freshTs();
    const signature = signTaskContract(recipient, messageId, SECRET, { timestamp, sender, attachments });
    // swap the attachment content
    const tamperedAttachments = [{ contentBase64: 'EVIL_DATA==' }];
    expect(
      verifySignature(
        { recipient, messageId, sender, attachments: tamperedAttachments, timestamp, signature },
        SECRET,
      ),
    ).toBe(false);
  });

  it('rejects when sender is changed after signing', () => {
    const timestamp = freshTs();
    const signature = signTaskContract(recipient, messageId, SECRET, { timestamp, sender, attachments });
    expect(
      verifySignature({ recipient, messageId, sender: 'evil@example.com', attachments, timestamp, signature }, SECRET),
    ).toBe(false);
  });

  it('rejects when the signed data (recipient/messageId) is altered', () => {
    const timestamp = freshTs();
    const signature = signTaskContract(recipient, messageId, SECRET, { timestamp, sender, attachments });
    expect(
      verifySignature({ recipient: 'evil@x', messageId, sender, attachments, timestamp, signature }, SECRET),
    ).toBe(false);
  });

  it('rejects a payload with no signature field', () => {
    const timestamp = freshTs();
    expect(verifySignature({ recipient, messageId, sender, attachments, timestamp }, SECRET)).toBe(false);
  });

  it('rejects a payload with no timestamp field', () => {
    const timestamp = freshTs();
    const signature = signTaskContract(recipient, messageId, SECRET, { timestamp, sender, attachments });
    expect(verifySignature({ recipient, messageId, sender, attachments, signature }, SECRET)).toBe(false);
  });

  it('rejects a stale timestamp (replay guard)', () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - TIMESTAMP_TOLERANCE_S - 60);
    const signature = signTaskContract(recipient, messageId, SECRET, {
      timestamp: staleTs,
      sender,
      attachments,
    });
    expect(
      verifySignature({ recipient, messageId, sender, attachments, timestamp: staleTs, signature }, SECRET),
    ).toBe(false);
  });
});

describe('verifySignature — repo fixture scheme / scheme-2 (snake_case, timestamp + compact body)', () => {
  it('accepts a payload signed as `${timestamp}.${JSON.stringify(body)}` with a fresh timestamp', () => {
    const timestamp = freshTs();
    const body = {
      message_id: '<d@mail>',
      to: 'juan.perez@ingest.ttr.example',
      attachments: [],
    };
    const signature = createHmac('sha256', SECRET)
      .update(`${timestamp}.${JSON.stringify(body)}`)
      .digest('hex');
    expect(verifySignature({ timestamp, signature, ...body }, SECRET)).toBe(true);
    // wrong secret fails
    expect(verifySignature({ timestamp, signature, ...body }, 'nope')).toBe(false);
  });

  it('rejects a stale timestamp under scheme-2 (replay guard)', () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - TIMESTAMP_TOLERANCE_S - 60);
    const body = { message_id: '<d@mail>', to: 'j@ingest.ttr.example', attachments: [] };
    const signature = createHmac('sha256', SECRET)
      .update(`${staleTs}.${JSON.stringify(body)}`)
      .digest('hex');
    expect(verifySignature({ timestamp: staleTs, signature, ...body }, SECRET)).toBe(false);
  });

  it('verifies the committed fixtures/receipt.webhook.json with secret "changeme" (timestamp check skipped)', () => {
    const path = fileURLToPath(
      new URL('../../../../fixtures/receipt.webhook.json', import.meta.url),
    );
    const fixture = JSON.parse(readFileSync(path, 'utf8'));
    // The fixture has a frozen timestamp, so we skip the recency check.
    expect(verifySignature(fixture, 'changeme', { skipTimestampCheck: true })).toBe(true);
    // and it normalizes cleanly
    const email = normalizeInbound(fixture);
    expect(email.recipient).toBe('juan.perez@ingest.ttr.example');
    expect(email.attachments[0]!.contentType).toBe('image/png');
  });
});

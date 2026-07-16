/**
 * Unit tests for attachment validation + object-key derivation (PRD 01 FR4/FR5).
 */
import { describe, it, expect } from 'vitest';
import {
  validateAttachments,
  buildObjectKey,
  extForMime,
  MAX_MESSAGE_BYTES,
} from '../attachments.js';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('extForMime — allowlist', () => {
  it('maps jpg/png/pdf and rejects everything else', () => {
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('IMAGE/PNG')).toBe('png'); // case-insensitive
    expect(extForMime('application/pdf')).toBe('pdf');
    expect(extForMime('image/gif')).toBeNull();
    expect(extForMime('application/x-msdownload')).toBeNull();
  });
});

describe('validateAttachments', () => {
  it('accepts allowlisted, decodes bytes, and reports size', () => {
    const { accepted, rejected } = validateAttachments([
      { filename: 'r.png', contentType: 'image/png', contentBase64: PNG_B64 },
    ]);
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.ext).toBe('png');
    expect(accepted[0]!.size).toBe(70); // 1×1 transparent PNG
    expect(Buffer.isBuffer(accepted[0]!.bytes)).toBe(true);
  });

  it('rejects a bad MIME and an empty body', () => {
    const { accepted, rejected } = validateAttachments([
      { filename: 'x.gif', contentType: 'image/gif', contentBase64: PNG_B64 },
      { filename: 'empty.pdf', contentType: 'application/pdf', contentBase64: '' },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected.map((r) => r.reason)).toEqual(['bad_mime', 'empty']);
  });

  it('rejects an oversize attachment (> 25 MiB decoded)', () => {
    const big = Buffer.alloc(MAX_MESSAGE_BYTES + 1).toString('base64');
    const { accepted, rejected } = validateAttachments([
      { filename: 'huge.pdf', contentType: 'application/pdf', contentBase64: big },
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0]!.reason).toBe('oversize');
  });

  it('rejects once the cumulative decoded size crosses the whole-message limit', () => {
    // two ~13 MiB attachments: first fits, second pushes the total over 25 MiB
    const half = Buffer.alloc(13 * 1024 * 1024).toString('base64');
    const { accepted, rejected } = validateAttachments([
      { filename: 'a.pdf', contentType: 'application/pdf', contentBase64: half },
      { filename: 'b.pdf', contentType: 'application/pdf', contentBase64: half },
    ]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.filename).toBe('a.pdf');
    expect(rejected[0]).toMatchObject({ filename: 'b.pdf', reason: 'oversize' });
  });
});

describe('buildObjectKey — PRD 01 FR5 layout', () => {
  it('builds receipts/{driver}/{yyyy}/{mm}/{message_id}-{index}.{ext}', () => {
    const key = buildObjectKey('drv-1', '<abc@mail>', 2, 'pdf', new Date('2026-03-09T00:00:00Z'));
    expect(key).toBe('receipts/drv-1/2026/03/abc@mail-2.pdf');
  });

  it('sanitizes unsafe characters in the message-id segment', () => {
    const key = buildObjectKey('drv-1', '<a/b c@mail>', 0, 'png', new Date('2026-11-01T00:00:00Z'));
    expect(key).toBe('receipts/drv-1/2026/11/a_b_c@mail-0.png');
  });
});

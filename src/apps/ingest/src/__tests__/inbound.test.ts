/**
 * Unit tests for the transport-agnostic inbound handler (PRD 01 FR1–11).
 *
 * @ttr/core is mocked entirely through the injected `InboundDeps` bundle (the handler
 * imports only *types* from @ttr/core, never its runtime), so these tests touch no DB,
 * S3, or SMTP. Covers: valid multi-attachment insert, dedupe, unknown recipient, bad
 * mime, oversize, bad signature, plus sender-trust + first_doc_received emission.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import { handleInbound, type InboundDeps } from '../handlers/inbound.js';
import type { Config, Driver, Document } from '@ttr/core';

const SECRET = 'test-secret';

const cfg = {
  webhookSecret: SECRET,
} as unknown as Config;

const DRIVER: Driver = {
  id: 'drv-1',
  carrier_id: 'car-1',
  name: 'Juan Pérez',
  registered_email: 'juan.perez@example.com',
  forwarding_address: 'juan.perez@ingest.ttr.example',
  onboarding_stage: 'authorized',
  created_at: '2026-07-01T00:00:00.000Z',
};

/** 1×1 transparent PNG (70 bytes) as base64 — a valid image/png. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Compute a scheme-1 (camelCase / body-covering) signature.
 * Must mirror the algorithm in webhook.ts exactly:
 *   HMAC(secret, `${timestamp}.${recipient}.${messageId}.${sender}.${sha256(bytes),...}`)
 */
function computeScheme1Sig(
  secret: string,
  timestamp: string,
  recipient: string,
  messageId: string,
  sender: string,
  attachments: Array<{ contentBase64: string }>,
): string {
  const hashes = attachments
    .map((a) => createHash('sha256').update(Buffer.from(a.contentBase64, 'base64')).digest('hex'))
    .join(',');
  const data = `${timestamp}.${recipient}.${messageId}.${sender}.${hashes}`;
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Build a camelCase (task-contract) webhook payload with a valid signature. */
function payload(
  overrides: {
    recipient?: string;
    messageId?: string;
    sender?: string;
    attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
    badSignature?: boolean;
    timestamp?: string;
  } = {},
): Record<string, unknown> {
  const recipient = overrides.recipient ?? DRIVER.forwarding_address;
  const messageId = overrides.messageId ?? '<syn-1@mail.example.com>';
  const sender = overrides.sender ?? DRIVER.registered_email!;
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const attachments =
    overrides.attachments ??
    [{ filename: 'receipt.png', contentType: 'image/png', contentBase64: PNG_B64 }];
  const signature = overrides.badSignature
    ? 'deadbeef'
    : computeScheme1Sig(SECRET, timestamp, recipient, messageId, sender, attachments);
  return {
    provider: 'mailgun_eu',
    sender,
    recipient,
    subject: 'factura',
    messageId,
    timestamp,
    signature,
    spf: 'pass',
    dkim: 'pass',
    dmarc: 'pass',
    attachments,
  };
}

/** A fresh mock deps bundle. `insertResults` lets a test script dedupe outcomes. */
function makeDeps(opts: {
  driver?: Driver | null;
  priorDocCount?: number;
  insert?: (doc: any) => { document: Document; created: boolean };
} = {}): {
  deps: InboundDeps;
  putObject: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  sendAck: ReturnType<typeof vi.fn>;
} {
  const putObject = vi.fn(async () => {});
  const emit = vi.fn(async () => {});
  const sendAck = vi.fn(async () => {});
  let seq = 0;
  const insert = vi.fn(async (doc: any) => {
    if (opts.insert) return opts.insert(doc);
    seq += 1;
    const document: Document = {
      id: `doc-${seq}`,
      driver_id: doc.driver_id ?? null,
      r2_key: doc.r2_key,
      from_addr: doc.from_addr ?? null,
      to_addr: doc.to_addr ?? null,
      message_id: doc.message_id,
      attachment_index: doc.attachment_index ?? 0,
      subject: doc.subject ?? null,
      mime: doc.mime ?? null,
      size_bytes: doc.size_bytes ?? null,
      source: 'forwarded',
      status: 'received',
      received_at: '2026-07-16T00:00:00.000Z',
    };
    return { document, created: true };
  });
  const deps: InboundDeps = {
    drivers: {
      findByForwardingAddress: vi.fn(async () =>
        opts.driver === undefined ? DRIVER : opts.driver,
      ),
    },
    documents: {
      insert,
      countByDriver: vi.fn(async () => opts.priorDocCount ?? 0),
    },
    metrics: { emit },
    putObject,
    sendAck,
  };
  return { deps, putObject, insert, emit, sendAck };
}

beforeEach(() => vi.clearAllMocks());

describe('handleInbound — happy path', () => {
  it('stores every attachment and records one Document each (multi-attachment)', async () => {
    const { deps, putObject, insert, emit, sendAck } = makeDeps();
    const p = payload({
      messageId: '<multi@mail>',
      attachments: [
        { filename: 'a.png', contentType: 'image/png', contentBase64: PNG_B64 },
        { filename: 'b.jpg', contentType: 'image/jpeg', contentBase64: PNG_B64 },
        { filename: 'invoice.pdf', contentType: 'application/pdf', contentBase64: PNG_B64 },
      ],
    });
    const out = await handleInbound(p, cfg, deps);

    expect(out.status).toBe(200);
    expect(putObject).toHaveBeenCalledTimes(3);
    expect(insert).toHaveBeenCalledTimes(3);
    if (out.status !== 200) throw new Error('unreachable');
    expect(out.body.stored).toHaveLength(3);
    expect(out.body.stored.map((s) => s.attachmentIndex)).toEqual([0, 1, 2]);
    // key layout: receipts/{driver}/{yyyy}/{mm}/{message_id}-{index}.{ext}
    expect(out.body.stored[0]!.r2Key).toMatch(
      /^receipts\/drv-1\/\d{4}\/\d{2}\/multi@mail-0\.png$/,
    );
    expect(out.body.stored[2]!.r2Key).toMatch(/-2\.pdf$/);
    // status is always 'received' — never extracted here (FR9)
    for (const call of insert.mock.calls) expect(call[0].status).toBe('received');
    // first_doc_received emitted once (driver had 0 prior docs)
    const firstDoc = emit.mock.calls.filter((c) => c[0] === 'first_doc_received');
    expect(firstDoc).toHaveLength(1);
    // bilingual ack sent to the sender
    expect(sendAck).toHaveBeenCalledOnce();
    expect(sendAck.mock.calls[0]![1].textBody).toMatch(/Recibido/);
    expect(sendAck.mock.calls[0]![1].textBody).toMatch(/Received/);
  });

  it('does NOT emit first_doc_received when the driver already had documents', async () => {
    const { deps, emit } = makeDeps({ priorDocCount: 5 });
    await handleInbound(payload(), cfg, deps);
    expect(emit.mock.calls.filter((c) => c[0] === 'first_doc_received')).toHaveLength(0);
  });
});

describe('handleInbound — dedupe (FR6)', () => {
  it('reports deduped:true and does not re-emit doc metrics on a resend', async () => {
    // insert returns created:false → the row already existed (message_id+index conflict)
    const existing: Document = {
      id: 'doc-existing',
      driver_id: 'drv-1',
      r2_key: 'receipts/drv-1/2026/07/dup@mail-0.png',
      from_addr: null,
      to_addr: null,
      message_id: '<dup@mail>',
      attachment_index: 0,
      subject: null,
      mime: 'image/png',
      size_bytes: 70,
      source: 'forwarded',
      status: 'received',
      received_at: '2026-07-16T00:00:00.000Z',
    };
    const { deps, emit } = makeDeps({
      priorDocCount: 1, // driver already had this doc
      insert: () => ({ document: existing, created: false }),
    });
    const out = await handleInbound(payload({ messageId: '<dup@mail>' }), cfg, deps);
    expect(out.status).toBe(200);
    if (out.status !== 200) throw new Error('unreachable');
    expect(out.body.stored[0]!.deduped).toBe(true);
    // no doc_received / first_doc_received for a pure resend
    expect(emit.mock.calls.filter((c) => c[0] === 'doc_received')).toHaveLength(0);
    expect(emit.mock.calls.filter((c) => c[0] === 'first_doc_received')).toHaveLength(0);
  });
});

describe('handleInbound — unknown recipient (FR10)', () => {
  it('returns 422, sends a nudge, and never stores anything', async () => {
    const { deps, putObject, insert, sendAck } = makeDeps({ driver: null });
    const out = await handleInbound(payload({ recipient: 'nobody@ingest.ttr.example' }), cfg, deps);
    expect(out.status).toBe(422);
    if (out.status !== 422) throw new Error('unreachable');
    expect(out.body.recipient).toBe('nobody@ingest.ttr.example');
    expect(putObject).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(sendAck).toHaveBeenCalledOnce(); // "not registered" nudge
    expect(sendAck.mock.calls[0]![1].textBody).toMatch(/no está registrada|not registered/);
  });
});

describe('handleInbound — bad MIME (FR4)', () => {
  it('rejects a non-allowlisted attachment (no store, no Document, reported)', async () => {
    const { deps, putObject, insert } = makeDeps();
    const out = await handleInbound(
      payload({
        attachments: [
          { filename: 'virus.exe', contentType: 'application/x-msdownload', contentBase64: PNG_B64 },
        ],
      }),
      cfg,
      deps,
    );
    expect(out.status).toBe(200);
    if (out.status !== 200) throw new Error('unreachable');
    expect(out.body.stored).toHaveLength(0);
    expect(out.body.rejected).toEqual([
      { attachmentIndex: 0, filename: 'virus.exe', reason: 'bad_mime' },
    ]);
    expect(putObject).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('accepts allowlisted attachments and rejects the rest in one email', async () => {
    const { deps, putObject } = makeDeps();
    const out = await handleInbound(
      payload({
        messageId: '<mixed@mail>',
        attachments: [
          { filename: 'ok.pdf', contentType: 'application/pdf', contentBase64: PNG_B64 },
          { filename: 'no.gif', contentType: 'image/gif', contentBase64: PNG_B64 },
        ],
      }),
      cfg,
      deps,
    );
    if (out.status !== 200) throw new Error('unreachable');
    expect(out.body.stored).toHaveLength(1);
    expect(out.body.stored[0]!.attachmentIndex).toBe(0);
    expect(out.body.rejected).toEqual([
      { attachmentIndex: 1, filename: 'no.gif', reason: 'bad_mime' },
    ]);
    expect(putObject).toHaveBeenCalledOnce();
  });
});

describe('handleInbound — oversize (FR4)', () => {
  it('rejects an attachment whose decoded size exceeds 25 MiB', async () => {
    // 26 MiB of zero bytes, base64-encoded.
    const big = Buffer.alloc(26 * 1024 * 1024).toString('base64');
    const { deps, putObject } = makeDeps();
    const out = await handleInbound(
      payload({
        attachments: [{ filename: 'huge.pdf', contentType: 'application/pdf', contentBase64: big }],
      }),
      cfg,
      deps,
    );
    if (out.status !== 200) throw new Error('unreachable');
    expect(out.body.stored).toHaveLength(0);
    expect(out.body.rejected[0]!.reason).toBe('oversize');
    expect(putObject).not.toHaveBeenCalled();
  });
});

describe('handleInbound — bad signature (§6)', () => {
  it('returns 401 and does no work when the signature is wrong', async () => {
    const { deps, putObject, insert, sendAck } = makeDeps();
    const out = await handleInbound(payload({ badSignature: true }), cfg, deps);
    expect(out.status).toBe(401);
    expect(putObject).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(sendAck).not.toHaveBeenCalled();
    expect(deps.drivers.findByForwardingAddress).not.toHaveBeenCalled();
  });
});

describe('handleInbound — sender trust (FR7)', () => {
  it('flags a From that does not match the driver registered_email', async () => {
    const { deps, emit } = makeDeps();
    const out = await handleInbound(payload({ sender: 'stranger@evil.example' }), cfg, deps);
    if (out.status !== 200) throw new Error('unreachable');
    expect(out.body.senderTrust).toBe('mismatch');
    expect(emit.mock.calls.some((c) => c[0] === 'ingest_sender_flagged')).toBe(true);
  });

  it('marks a matching From as trusted and does not flag', async () => {
    const { deps, emit } = makeDeps();
    const out = await handleInbound(payload(), cfg, deps);
    if (out.status !== 200) throw new Error('unreachable');
    expect(out.body.senderTrust).toBe('match');
    expect(emit.mock.calls.some((c) => c[0] === 'ingest_sender_flagged')).toBe(false);
  });
});

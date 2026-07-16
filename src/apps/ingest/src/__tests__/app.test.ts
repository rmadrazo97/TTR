/**
 * Route-level tests for the Hono app. Here @ttr/core is mocked at the MODULE level
 * (vi.mock) so `createApp()` with no args wires the mocked repos/storage/email — proving
 * the whole edge (JSON parse → handler → status mapping) works without a real DB/S3/SMTP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac, createHash } from 'node:crypto';

const SECRET = 'app-secret';
const RECIPIENT = 'juan.perez@ingest.ttr.example';

// vi.hoisted so the mock factory can close over shared spies created before hoisting.
const h = vi.hoisted(() => ({
  findByForwardingAddress: undefined as any,
  insert: undefined as any,
  countByDriver: undefined as any,
  emit: undefined as any,
  putObject: undefined as any,
  sendAck: undefined as any,
}));

vi.mock('@ttr/core', () => {
  return {
    loadConfig: () => ({ webhookSecret: SECRET }),
    drivers: { findByForwardingAddress: (...a: any[]) => h.findByForwardingAddress(...a) },
    documents: {
      insert: (...a: any[]) => h.insert(...a),
    },
    metrics: { emit: (...a: any[]) => h.emit(...a) },
    putObject: (...a: any[]) => h.putObject(...a),
    sendAck: (...a: any[]) => h.sendAck(...a),
    query: (...a: any[]) => h.countByDriver(...a),
  };
});

const { createApp } = await import('../app.js');

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const DEFAULT_SENDER = 'juan.perez@example.com';

/**
 * Compute a scheme-1 signature — must mirror webhook.ts exactly.
 * Signs `${timestamp}.${recipient}.${messageId}.${sender}.${sha256(bytes),...}`
 */
function sign(
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
  return createHmac('sha256', SECRET).update(data).digest('hex');
}

function body(messageId: string, recipient = RECIPIENT) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sender = DEFAULT_SENDER;
  const attachments = [
    {
      filename: 'r.png',
      contentType: 'image/png',
      contentBase64: PNG_B64,
    },
  ];
  return {
    provider: 'postmark',
    sender,
    recipient,
    subject: 'factura',
    messageId,
    timestamp,
    signature: sign(timestamp, recipient, messageId, sender, attachments),
    attachments,
  };
}

beforeEach(() => {
  h.findByForwardingAddress = vi.fn(async () => ({
    id: 'drv-1',
    registered_email: 'juan.perez@example.com',
    forwarding_address: RECIPIENT,
  }));
  h.insert = vi.fn(async (doc: any) => ({
    document: { id: 'doc-1', ...doc },
    created: true,
  }));
  h.countByDriver = vi.fn(async () => [{ n: '0' }]); // query() shape used by countByDriver
  h.emit = vi.fn(async () => {});
  h.putObject = vi.fn(async () => {});
  h.sendAck = vi.fn(async () => {});
});

async function post(app: any, payload: unknown): Promise<Response> {
  return app.request('/inbound', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ status: 'ok', service: '@ttr/ingest' });
  });
});

describe('POST /inbound — status mapping', () => {
  it('200 on a valid webhook and stores the document', async () => {
    const app = createApp();
    const res = await post(app, body('<m1@mail>'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.stored).toHaveLength(1);
    expect(h.putObject).toHaveBeenCalledOnce();
    expect(h.insert).toHaveBeenCalledOnce();
  });

  it('401 on a bad signature', async () => {
    const app = createApp();
    const res = await post(app, { ...body('<m2@mail>'), signature: 'bad' });
    expect(res.status).toBe(401);
    expect(h.putObject).not.toHaveBeenCalled();
  });

  it('422 on an unknown recipient', async () => {
    h.findByForwardingAddress = vi.fn(async () => null);
    const app = createApp();
    const res = await post(app, body('<m3@mail>', 'nobody@ingest.ttr.example'));
    expect(res.status).toBe(422);
  });

  it('400 on a non-JSON body', async () => {
    const app = createApp();
    const res = await app.request('/inbound', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

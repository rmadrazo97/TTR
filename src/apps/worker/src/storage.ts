/**
 * Object download for the extraction worker.
 *
 * `@ttr/core`'s storage module writes objects (`putObject`) and presigns reads
 * (`getSignedUrl`) for the console, but the worker needs the *bytes* of a receipt to
 * feed the vision extractor. Rather than touch core, we open a small S3 v3 client here
 * with the SAME config core uses (`loadConfig().s3`) — endpoint + `forcePathStyle`, so
 * it works against MinIO locally and Cloudflare R2 (jurisdiction=eu) in prod.
 *
 * The download is exposed behind a tiny {@link BlobStore} interface so `processOnce`
 * can be unit-tested with an in-memory stub (no S3 / MinIO needed for tests).
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadConfig } from '@ttr/core';

/** Minimal read seam the worker depends on — trivially stubbable in tests. */
export interface BlobStore {
  /** Download an object's full contents by key. */
  getObject(key: string): Promise<Buffer>;
}

let client: S3Client | undefined;
let bucket: string | undefined;

function getClient(): { s3: S3Client; bucket: string } {
  if (!client || !bucket) {
    const cfg = loadConfig().s3;
    client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
      forcePathStyle: cfg.forcePathStyle,
    });
    bucket = cfg.bucket;
  }
  return { s3: client, bucket };
}

/** Read a Node stream (S3 GetObject body) into a single Buffer. */
async function streamToBuffer(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * The default, real blob store: downloads from MinIO/R2 using the shared S3 config.
 * Lazily constructs its client so importing this module never touches the network.
 */
export const s3BlobStore: BlobStore = {
  async getObject(key: string): Promise<Buffer> {
    const { s3, bucket } = getClient();
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = res.Body;
    if (!body) {
      throw new Error(`[worker storage] empty body for key: ${key}`);
    }
    // In Node, the SDK returns a Readable which is AsyncIterable<Uint8Array>.
    return streamToBuffer(body as unknown as AsyncIterable<Uint8Array>);
  },
};

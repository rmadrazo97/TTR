/**
 * Object storage via the AWS S3 v3 SDK. Works against MinIO locally and Cloudflare R2
 * (jurisdiction=eu) in prod — the only differences are the endpoint, credentials, and
 * `forcePathStyle`, all supplied by {@link loadConfig}.
 *
 * Keys follow PRD 01/03: `receipts/{driver_id}/{yyyy}/{mm}/{message_id}-{n}.{ext}`.
 */
import { PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { loadConfig, type S3Config } from './config.js';

let client: S3Client | undefined;
let bucket: string | undefined;

function getClient(): { s3: S3Client; bucket: string } {
  if (!client || !bucket) {
    const cfg: S3Config = loadConfig().s3;
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

/** Upload an object (attachment) to the receipts bucket. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const { s3, bucket } = getClient();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Return a short-lived pre-signed GET URL for an object — how the console shows the
 * receipt image without exposing bucket credentials. Default expiry 15 minutes.
 */
export async function getSignedUrl(key: string, expiresSec = 900): Promise<string> {
  const { s3, bucket } = getClient();
  return presign(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expiresSec,
  });
}

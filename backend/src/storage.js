import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

let client = null;

export function isStorageConfigured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

function getClient() {
  if (client) return client;
  if (!isStorageConfigured()) throw new Error('Object storage is not configured.');
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    },
    // Keep socket usage bounded so many parallel uploads/downloads don't
    // exhaust the connection pool (this was a warning we saw in production
    // logs under load).
    maxAttempts: 3
  });
  return client;
}

export async function putObject(key, body, contentType) {
  const bucket = process.env.R2_BUCKET_NAME;
  await getClient().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObjectBuffer(key) {
  const bucket = process.env.R2_BUCKET_NAME;
  const result = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function listObjects(prefix) {
  const bucket = process.env.R2_BUCKET_NAME;
  const out = [];
  let ContinuationToken;
  do {
    const page = await getClient().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken })
    );
    out.push(...(page.Contents || []));
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
}

export async function deleteObject(key) {
  const bucket = process.env.R2_BUCKET_NAME;
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export function publicUrlFor(key) {
  const base = String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!base || !key) return '';
  return `${base}/${String(key).replace(/^\/+/, '')}`;
}

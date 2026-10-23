import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

let client = null;

export function isStorageConfigured() {
  return Boolean(
    config.r2.accountId &&
    config.r2.accessKeyId &&
    config.r2.secretAccessKey &&
    config.r2.bucketName
  );
}

function getClient() {
  if (client) return client;
  if (!isStorageConfigured()) throw new Error('Object storage is not configured.');
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey
    },
    // Keep socket usage bounded so many parallel uploads/downloads don't
    // exhaust the connection pool (this was a warning we saw in production
    // logs under load).
    maxAttempts: 3
  });
  return client;
}

export async function putObject(key, body, contentType, { cacheControl } = {}) {
  const bucket = config.r2.bucketName;
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(cacheControl ? { CacheControl: cacheControl } : {})
  }));
}

export async function deleteObject(key) {
  const bucket = config.r2.bucketName;
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export function publicUrlFor(key) {
  const base = String(config.r2.publicBaseUrl || '').replace(/\/+$/, '');
  if (!base || !key) return '';
  return `${base}/${String(key).replace(/^\/+/, '')}`;
}

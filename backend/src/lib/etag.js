import { createHash } from 'node:crypto';

const etagFor = (value) => `"${createHash('sha256').update(value).digest('base64url')}"`;

export function sendEtaggedJson(req, res, payload, cacheControl = 'private, no-cache') {
  const body = JSON.stringify(payload);
  const etag = etagFor(body);
  res.set({
    ETag: etag,
    'Cache-Control': cacheControl,
    'Content-Type': 'application/json; charset=utf-8'
  });
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  return res.send(body);
}

export function sendEtaggedText(req, res, body, contentType, filename) {
  const etag = etagFor(body);
  res.set({ ETag: etag, 'Cache-Control': 'private, max-age=60', 'Content-Type': contentType });
  if (filename) res.set('Content-Disposition', `attachment; filename="${filename}"`);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  return res.send(body);
}

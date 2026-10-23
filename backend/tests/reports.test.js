import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createErrorHandler } from '../src/middleware/errors.js';
import { createAdminRouter } from '../src/modules/admin/routes.js';
import { createReportRouter } from '../src/modules/reports/routes.js';

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function auth(req, _res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return next(Object.assign(new Error('Sign in to continue.'), { status: 401, code: 'UNAUTHENTICATED' }));
  req.user = { uid: token };
  next();
}

test('authenticated buyers can report an active listing once with a bounded reason', async (t) => {
  const reports = new Map();
  const product = { id: '11111111-1111-4111-8111-111111111111', sellerUid: 'seller-1', status: 'active' };
  const harness = await listen(express()
    .use(express.json())
    .use('/api', createReportRouter({
      authMiddleware: auth,
      rateLimiter: (_req, _res, next) => next(),
      getProduct: async () => product,
      createReport: async (report) => {
        const key = `${report.productId}:${report.reporterUid}`;
        if (reports.has(key)) throw Object.assign(new Error('Duplicate'), { code: 11000 });
        reports.set(key, report);
      }
    }))
    .use(createErrorHandler({ isProduction: true })));
  t.after(harness.close);

  const submit = (token, payload) => fetch(`${harness.url}/api/products/${product.id}/reports`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.equal((await submit('buyer-1', { reason: 'misleading', details: 'Wrong origin.' })).status, 201);
  assert.equal((await submit('buyer-1', { reason: 'other', details: '' })).status, 409);
  assert.equal((await submit('seller-1', { reason: 'unsafe', details: '' })).status, 404);
  assert.equal((await submit('buyer-2', { reason: 'unknown', details: '' })).status, 400);
  assert.equal(reports.size, 1);
});

test('admin takedown removes a reported listing and audits the action', async (t) => {
  const audits = [];
  const report = { id: 'report-1', productId: '11111111-1111-4111-8111-111111111111', status: 'open' };
  let productStatus = 'active';
  let resolved = false;
  const harness = await listen(express()
    .use(express.json())
    .use('/api', createAdminRouter({
      authMiddleware: auth,
      requireAdminMiddleware: (req, _res, next) => req.user.uid === 'admin' ? next() : next(Object.assign(new Error('Forbidden'), { status: 403 })),
      audit: async (entry) => audits.push(entry),
      getReport: async () => resolved ? { ...report, status: 'resolved' } : report,
      getProduct: async () => ({ id: report.productId, status: productStatus }),
      changeProduct: async (id, changes, expectedStatus) => {
        if (id !== report.productId || productStatus !== expectedStatus) return null;
        productStatus = changes.status;
        return { id, status: productStatus };
      },
      resolveReport: async () => {
        if (resolved) return null;
        resolved = true;
        return { ...report, status: 'resolved' };
      }
    }))
    .use(createErrorHandler({ isProduction: true })));
  t.after(harness.close);

  const response = await fetch(`${harness.url}/api/admin/reports/report-1/takedown`, {
    method: 'POST',
    headers: { authorization: 'Bearer admin', 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Prohibited item' })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).product.status, 'removed');
  assert.equal(audits[0].action, 'listing.taken_down');
  assert.equal(productStatus, 'removed');
});

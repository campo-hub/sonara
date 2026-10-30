import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createErrorHandler } from '../src/middleware/errors.js';
import { createAdminRouter } from '../src/modules/admin/routes.js';
import { createReviewRouter } from '../src/modules/reviews/routes.js';

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
  if (!token) {
    const error = Object.assign(new Error('Sign in to continue.'), { status: 401, code: 'UNAUTHENTICATED' });
    return next(error);
  }
  req.user = { uid: token };
  next();
}

test('review requires a completed buyer order and updates product ratings', async (t) => {
  const reviews = new Map();
  const ratings = { average: 0, count: 0 };
  const harness = await listen(express()
    .use(express.json())
    .use('/api', createReviewRouter({
      authMiddleware: auth,
      completedOrderLookup: async (orderId, productId, buyerUid) => (
        orderId === 'order-1' && productId === 'product-1' && buyerUid === 'buyer-1'
          ? { items: [{ productId, sellerUid: 'seller-1' }] }
          : null
      ),
      createReview: async (review) => {
        const key = `${review.orderId}:${review.productId}`;
        if (reviews.has(key)) throw Object.assign(new Error('Duplicate review'), { code: 11000 });
        reviews.set(key, review);
      },
      updateProductRating: async (_productId, rating) => {
        ratings.average = (ratings.average * ratings.count + rating) / (ratings.count + 1);
        ratings.count += 1;
        return true;
      }
    }))
    .use(createErrorHandler({ isProduction: true })));
  t.after(harness.close);

  const ineligible = await fetch(`${harness.url}/api/products/product-1/reviews`, {
    method: 'POST',
    headers: { authorization: 'Bearer buyer-2', 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: 'order-2', rating: 5, comment: '' })
  });
  assert.equal(ineligible.status, 403);

  const payload = { orderId: 'order-1', rating: 4, comment: 'Good produce.' };
  const response = await fetch(`${harness.url}/api/products/product-1/reviews`, {
    method: 'POST',
    headers: { authorization: 'Bearer buyer-1', 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).review.sellerUid, 'seller-1');
  assert.equal(ratings.average, 4);
  assert.equal(ratings.count, 1);

  const duplicate = await fetch(`${harness.url}/api/products/product-1/reviews`, {
    method: 'POST',
    headers: { authorization: 'Bearer buyer-1', 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.equal(duplicate.status, 409);
  assert.equal(ratings.count, 1);
});

test('admin listing actions are protected and audited', async (t) => {
  const audits = [];
  const harness = await listen(express()
    .use(express.json())
    .use('/api', createAdminRouter({
      authMiddleware: auth,
      requireAdminMiddleware: (req, _res, next) => req.user.uid === 'admin'
        ? next()
        : next(Object.assign(new Error('Forbidden'), { status: 403, code: 'FORBIDDEN' })),
      audit: async (entry) => audits.push(entry),
      notifyFn: async () => {},
      changeProduct: async (id, update, expectedStatus) => (
        id === 'product-1' && expectedStatus === 'pending'
          ? { id, status: update.status, sellerUid: 'seller-1', title: 'Tomatoes' }
          : null
      )
    }))
    .use(createErrorHandler({ isProduction: true })));
  t.after(harness.close);

  const denied = await fetch(`${harness.url}/api/admin/listings`);
  assert.equal(denied.status, 401);

  const approved = await fetch(`${harness.url}/api/admin/listings/product-1/approve`, {
    method: 'POST',
    headers: { authorization: 'Bearer admin', 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).product.status, 'active');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'listing.approved');
  assert.equal(audits[0].actorUid, 'admin');
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createErrorHandler } from '../src/middleware/errors.js';
import { filterComparableProducts } from '../src/modules/products/store.js';
import { createMessagingRouter } from '../src/modules/messaging/routes.js';
import { createNotificationRouter } from '../src/modules/notifications/routes.js';
import { createAdminRouter } from '../src/modules/admin/routes.js';
import { createProductRouter } from '../src/modules/products/routes.js';
import { createCategoryAdminRouter } from '../src/modules/admin/categories.js';

const pass = (_req, _res, next) => next();
const authenticate = (req, _res, next) => {
  const uid = req.headers['x-test-user'];
  if (!uid) return next(Object.assign(new Error('Sign in.'), { status: 401, code: 'UNAUTHENTICATED' }));
  req.user = { uid };
  return next();
};

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

function requestHeaders(uid) {
  return { 'content-type': 'application/json', ...(uid ? { 'x-test-user': uid } : {}) };
}

test('price comparison normalizes names, excludes self/unavailable listings, filters county, and sorts by integer KES', () => {
  const product = { id: 'target', title: 'Fresh Tomatoes!', category: 'vegetables', pricePerUnit: 100, status: 'active', quantityAvailable: 5, location: { county: 'Kiambu' } };
  const candidate = (id, fields = {}) => ({
    id, title: 'fresh tomatoes', category: 'vegetables', pricePerUnit: 80, status: 'active',
    quantityAvailable: 3, location: { county: 'Kiambu' }, ...fields
  });
  const results = filterComparableProducts([
    product,
    candidate('expensive', { pricePerUnit: 120 }),
    candidate('cheap', { pricePerUnit: 40 }),
    candidate('nairobi', { location: { county: 'Nairobi' } }),
    candidate('empty', { quantityAvailable: 1, quantityReserved: 1 }),
    candidate('other', { title: 'Tomato seedlings' })
  ], product, { county: 'kiambu' });
  assert.deepEqual(results.map(({ id }) => id), ['cheap', 'expensive']);
});

test('price comparison endpoint returns seller, location, rating, and whole-shilling prices', async (t) => {
  const product = { id: 'target', title: 'Tomatoes', status: 'active' };
  const match = {
    id: 'match-1', title: 'Tomatoes', status: 'active', sellerUid: 'seller-1', category: 'vegetables',
    pricePerUnit: 75, unit: 'kg', quantityAvailable: 4, quantityReserved: 0,
    ratingAvg: 4.5, ratingCount: 2, location: { county: 'Kiambu', town: 'Thika' },
    images: [], createdAt: new Date(), updatedAt: new Date()
  };
  const router = createProductRouter({
    store: { getProductById: async () => product },
    optionalAuthMiddleware: (req, _res, next) => { req.user = null; next(); },
    findComparables: async () => [match],
    getSellerProfile: async () => ({ displayName: 'Farm One' })
  });
  const harness = await listen(express().use('/api', router).use(createErrorHandler()));
  t.after(harness.close);
  const response = await fetch(`${harness.url}/api/products/target/price-comparison?county=Kiambu`);
  assert.equal(response.status, 200);
  const { comparisons } = await response.json();
  assert.equal(comparisons[0].seller.displayName, 'Farm One');
  assert.equal(comparisons[0].product.pricePerUnit, 75);
  assert.equal(comparisons[0].product.location.town, 'Thika');
  assert.equal(comparisons[0].product.ratingAvg, 4.5);
});

test('messaging enforces participant authorization, sanitizes and limits messages, and permits admin report review', async (t) => {
  const conversations = new Map();
  const messages = [];
  const reports = [];
  const router = createMessagingRouter({
    authMiddleware: authenticate,
    requireAdminMiddleware: (req, _res, next) => req.user.uid === 'admin' ? next() : next(Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' })),
    rateLimiter: pass,
    getProduct: async (id) => id === 'product-1' ? { id, title: 'Tomatoes', status: 'active', sellerUid: 'seller-1' } : null,
    createConversation: async (value) => {
      const conversation = { ...value, lastMessage: '' };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    getConversationById: async (id) => conversations.get(id) || null,
    createMessage: async (message) => { messages.push(message); return message; },
    listForUser: async (uid) => [...conversations.values()].filter((item) => item.participants.includes(uid)),
    listForConversation: async (id, { limit }) => messages.filter((item) => item.conversationId === id).slice(-limit).reverse(),
    markRead: async (id, uid, at) => ({ ...conversations.get(id), readAt: { [uid]: at } }),
    createReport: async (report) => { reports.push(report); return report; },
    listReports: async () => reports,
    getReport: async (id) => reports.find((item) => item.id === id) || null
  });
  const harness = await listen(express().use(express.json()).use('/api', router).use(createErrorHandler()));
  t.after(harness.close);

  const started = await fetch(`${harness.url}/api/conversations`, {
    method: 'POST', headers: requestHeaders('buyer-1'),
    body: JSON.stringify({ productId: 'product-1', message: '<b>Hello</b> farmer' })
  });
  assert.equal(started.status, 201);
  const { conversation, message } = await started.json();
  assert.equal(message.text, 'Hello farmer');
  assert.equal(conversation.participants.includes('seller-1'), true);

  const denied = await fetch(`${harness.url}/api/conversations/${conversation.id}/messages`, { headers: requestHeaders('stranger') });
  assert.equal(denied.status, 404);
  const tooLong = await fetch(`${harness.url}/api/conversations/${conversation.id}/messages`, {
    method: 'POST', headers: requestHeaders('seller-1'),
    body: JSON.stringify({ text: 'x'.repeat(2001) })
  });
  assert.equal(tooLong.status, 400);

  const reportResponse = await fetch(`${harness.url}/api/conversations/${conversation.id}/reports`, {
    method: 'POST', headers: requestHeaders('buyer-1'), body: JSON.stringify({ reason: 'Please review this conversation.' })
  });
  assert.equal(reportResponse.status, 201);
  const report = (await reportResponse.json()).report;
  const adminMessages = await fetch(`${harness.url}/api/admin/message-reports/${report.id}/messages`, { headers: requestHeaders('admin') });
  assert.equal(adminMessages.status, 200);
  assert.equal((await adminMessages.json()).messages[0].text, 'Hello farmer');
});

test('notification feed scopes reads to the authenticated user and returns unread count', async (t) => {
  const entries = [{ id: 'n1', uid: 'buyer-1', readAt: null }];
  const router = createNotificationRouter({
    authMiddleware: authenticate,
    list: async (uid) => entries.filter((entry) => entry.uid === uid),
    countUnread: async (uid) => entries.filter((entry) => entry.uid === uid && !entry.readAt).length,
    markRead: async (uid, id) => {
      const entry = entries.find((item) => item.uid === uid && item.id === id);
      if (!entry) return null;
      entry.readAt = new Date();
      return entry;
    },
    markAllRead: async () => 0
  });
  const harness = await listen(express().use('/api', router).use(createErrorHandler()));
  t.after(harness.close);

  const response = await fetch(`${harness.url}/api/notifications`, { headers: requestHeaders('buyer-1') });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).unreadCount, 1);
  const forbidden = await fetch(`${harness.url}/api/notifications/n1/read`, { method: 'POST', headers: requestHeaders('seller-1') });
  assert.equal(forbidden.status, 404);
  const read = await fetch(`${harness.url}/api/notifications/n1/read`, { method: 'POST', headers: requestHeaders('buyer-1') });
  assert.equal(read.status, 200);
});

test('admin summary and CSV export expose only the injected report data to admins', async (t) => {
  const summary = {
    generatedAt: new Date('2026-10-30T00:00:00Z'),
    users: { total: 14 },
    listings: { byCategory: [{ category: 'vegetables', count: 8 }], byCounty: [{ county: 'Kiambu', count: 4 }] },
    orders: { byStatus: [{ status: 'completed', count: 3 }] },
    gmv: { amountKes: 2500, orderCount: 3 },
    payouts: []
  };
  const router = createAdminRouter({
    authMiddleware: authenticate,
    requireAdminMiddleware: (req, _res, next) => req.user.uid === 'admin' ? next() : next(Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' })),
    getSummary: async () => summary,
    audit: async () => {}
  });
  const harness = await listen(express().use('/api', router).use(createErrorHandler()));
  t.after(harness.close);
  const unauthorized = await fetch(`${harness.url}/api/admin/reports/summary`, { headers: requestHeaders('buyer-1') });
  assert.equal(unauthorized.status, 403);
  const response = await fetch(`${harness.url}/api/admin/reports/summary`, { headers: requestHeaders('admin') });
  assert.equal((await response.json()).summary.gmv.amountKes, 2500);
  const csv = await fetch(`${harness.url}/api/admin/reports/summary.csv`, { headers: requestHeaders('admin') });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /"gmv","total","3","2500"/);
});

test('category administration supports create, rename, delete, and admin-only access', async (t) => {
  const categories = new Map([['vegetables', 'vegetables']]);
  const router = createCategoryAdminRouter({
    authMiddleware: authenticate,
    requireAdminMiddleware: (req, _res, next) => req.user.uid === 'admin' ? next() : next(Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' })),
    list: async () => [...categories.values()],
    create: async (name) => { categories.set(name, name); return { id: name, name }; },
    rename: async (id, name) => {
      if (!categories.has(id)) return null;
      categories.delete(id);
      categories.set(name, name);
      return { id: name, name };
    },
    remove: async (id) => categories.delete(id)
  });
  const harness = await listen(express().use(express.json()).use('/api', router).use(createErrorHandler()));
  t.after(harness.close);
  const denied = await fetch(`${harness.url}/api/admin/categories`, { headers: requestHeaders('buyer-1') });
  assert.equal(denied.status, 403);
  const created = await fetch(`${harness.url}/api/admin/categories`, {
    method: 'POST', headers: requestHeaders('admin'), body: JSON.stringify({ name: 'legumes' })
  });
  assert.equal(created.status, 201);
  const renamed = await fetch(`${harness.url}/api/admin/categories/legumes`, {
    method: 'PATCH', headers: requestHeaders('admin'), body: JSON.stringify({ name: 'pulses' })
  });
  assert.equal(renamed.status, 200);
  const deleted = await fetch(`${harness.url}/api/admin/categories/pulses`, {
    method: 'DELETE', headers: requestHeaders('admin')
  });
  assert.equal(deleted.status, 200);
});

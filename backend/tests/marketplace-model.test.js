import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureIndexes, INDEX_DEFINITIONS } from '../src/db.js';
import { createId } from '../src/lib/ids.js';
import {
  validateOrder,
  validatePayment,
  validateProduct,
  validateReview,
  validateAuditLog,
  validateUser
} from '../src/models/marketplace.js';

const now = new Date('2026-10-23T00:00:00.000Z');
const productId = 'a76f99df-b8be-4a50-8c8b-637b1acc9801';
const orderId = '067a30ad-c7f7-491b-85cf-625dc32571d4';
const paymentId = 'ac6875a8-8e38-4677-8e50-3d8870a60e61';
const reviewId = '4e4b1d92-ab02-49ab-b967-b1ae1dc13da4';

const product = () => ({
  id: productId,
  sellerUid: 'seller-1',
  status: 'pending',
  title: 'Maize',
  description: 'Fresh maize from the farm.',
  category: 'cereals',
  unit: 'kg',
  pricePerUnit: 75,
  minOrder: 1,
  quantityAvailable: 25,
  quantityReserved: 0,
  grade: 'Grade 1',
  images: [{
    key: 'products/product-1/photo.webp',
    url: 'https://cdn.example.test/photo.webp',
    thumbKey: 'products/product-1/photo-thumb.webp',
    thumbUrl: 'https://cdn.example.test/photo-thumb.webp',
    width: 1200,
    height: 800
  }],
  location: { county: 'Kiambu', town: 'Thika', geo: { type: 'Point', coordinates: [-1.05, -1.1] } },
  ratingAvg: 0,
  ratingCount: 0,
  createdAt: now,
  updatedAt: now
});

const order = () => ({
  id: orderId,
  buyerUid: 'buyer-1',
  status: 'pending_payment',
  items: [{
    productId,
    sellerUid: 'seller-1',
    titleSnapshot: 'Maize',
    unit: 'kg',
    qty: 2,
    unitPrice: 75,
    lineTotal: 150
  }],
  subtotal: 150,
  deliveryFee: 0,
  total: 150,
  delivery: { method: 'pickup', county: 'Kiambu', phone: '+254712345678' },
  merchantReference: 'ord_abc-123',
  statusHistory: [{ status: 'pending_payment', at: now, by: 'buyer-1' }],
  createdAt: now,
  updatedAt: now,
  reservationExpiresAt: new Date(now.valueOf() + 15 * 60 * 1000)
});

test('user validator accepts supported roles and rejects invalid role/profile data', () => {
  assert.equal(validateUser({ uid: 'user-1', email: 'buyer@example.test', roles: ['buyer'], createdAt: now, updatedAt: now }), '');
  assert.match(validateUser({ uid: 'user-1', email: '', roles: ['owner'] }), /roles/);
  assert.match(validateUser({
    uid: 'user-1',
    email: '',
    roles: ['seller'],
    sellerProfile: { displayName: 'Seller', bio: '', county: 'Kiambu', town: 'Thika', verified: 'yes' }
  }), /Seller profile/);
});

test('product validator accepts marketplace products and rejects invalid money, stock, and image metadata', () => {
  assert.equal(validateProduct(product()), '');
  assert.match(validateProduct({ ...product(), pricePerUnit: 12.5 }), /whole-shilling/);
  assert.match(validateProduct({ ...product(), pricePerUnit: '75' }), /whole-shilling/);
  assert.match(validateProduct({ ...product(), id: 'from-file-name.jpg' }), /UUID/);
  assert.match(validateProduct({ ...product(), quantityReserved: 26 }), /stock values/);
  assert.match(validateProduct({ ...product(), images: [{ ...product().images[0], width: 0 }] }), /image metadata/);
  assert.match(validateProduct({
    ...product(),
    location: { county: 'Kiambu', town: 'Thika', geo: { type: 'Point', coordinates: [-181, 0] } }
  }), /GeoJSON Point/);
});

test('order validator checks supported states, URL-safe references, and integer totals', () => {
  assert.equal(validateOrder(order()), '');
  assert.match(validateOrder({ ...order(), status: 'awaiting' }), /status/);
  assert.match(validateOrder({ ...order(), merchantReference: 'order/123' }), /URL-safe/);
  assert.match(validateOrder({ ...order(), total: 149 }), /money totals/);
  assert.match(validateOrder({
    ...order(),
    items: [{ ...order().items[0], lineTotal: 150.5 }]
  }), /line total/);
});

test('payment and review validators enforce provider, KES, status, uniqueness fields, and rating bounds', () => {
  const payment = {
    id: paymentId,
    orderId,
    provider: 'pesapal',
    orderTrackingId: 'track-1',
    merchantReference: 'ord_abc-123',
    amount: 150,
    currency: 'KES',
    status: 'created',
    ipnReceivedAt: [],
    createdAt: now,
    updatedAt: now
  };
  assert.equal(validatePayment(payment), '');
  assert.match(validatePayment({ ...payment, currency: 'USD' }), /amount or currency/);
  assert.match(validatePayment({ ...payment, status: 'settled' }), /status/);
  assert.match(validatePayment({ ...payment, amount: '150' }), /amount or currency/);

  const review = {
    id: reviewId,
    productId,
    orderId,
    buyerUid: 'buyer-1',
    sellerUid: 'seller-1',
    rating: 5,
    comment: 'Fresh produce.',
    createdAt: now
  };
  assert.equal(validateReview(review), '');
  assert.match(validateReview({ ...review, rating: 6 }), /rating/);
  assert.match(validateReview({ ...review, comment: 'x'.repeat(501) }), /comment/);
  assert.equal(validateAuditLog({
    at: now,
    actorUid: 'admin-1',
    action: 'product.approved',
    entity: 'product',
    entityId: productId,
    meta: { status: 'active' }
  }), '');
  assert.match(validateAuditLog({ at: now, actorUid: 'admin-1', action: 'delete' }), /fields/);
});

test('ensureIndexes applies stable, repeatable indexes for marketplace collections', async () => {
  const calls = [];
  const db = {
    collection(name) {
      return {
        createIndex: async (key, options) => {
          calls.push({ name, key, options });
          return `${name}_${calls.length}`;
        }
      };
    }
  };

  await ensureIndexes(db);
  const firstRun = structuredClone(calls);
  await ensureIndexes(db);
  const secondRun = calls.slice(firstRun.length);
  assert.deepEqual(secondRun, firstRun);
  assert.equal(INDEX_DEFINITIONS.some((entry) => entry.collection === 'products'
    && entry.key['location.geo'] === '2dsphere'), true);
  assert.equal(INDEX_DEFINITIONS.some((entry) => entry.collection === 'payments'
    && entry.key.orderTrackingId === 1 && entry.options?.unique && entry.options?.sparse), true);
  assert.equal(INDEX_DEFINITIONS.some((entry) => entry.collection === 'payments'
    && entry.key.merchantReference === 1 && entry.options?.unique), true);
  assert.equal(INDEX_DEFINITIONS.some((entry) => entry.collection === 'reviews'
    && entry.key.orderId === 1 && entry.key.productId === 1 && entry.options?.unique), true);
  await assert.rejects(ensureIndexes(null), /connected database/);
});

test('createId returns UUIDs independent of filenames', () => {
  const id = createId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

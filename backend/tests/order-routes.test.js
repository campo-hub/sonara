import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createErrorHandler } from '../src/middleware/errors.js';
import { createOrderRouter } from '../src/modules/orders/routes.js';
import { createOrderService } from '../src/modules/orders/service.js';

const users = {
  buyer: { uid: 'buyer-1' },
  sellerA: { uid: 'seller-a' },
  sellerB: { uid: 'seller-b' },
  other: { uid: 'other-user' }
};

function makeHarness({ products = [], failInsertAt = 0 } = {}) {
  const productMap = new Map(products.map((product) => [product.id, structuredClone(product)]));
  const orders = new Map();
  let insertAttempts = 0;
  const productStore = {
    async getProductById(id) {
      return structuredClone(productMap.get(id) || null);
    },
    async reserveProductQuantity(id, qty, expectedProduct) {
      const product = productMap.get(id);
      if (!product || product.status !== 'active'
        || product.quantityAvailable - (product.quantityReserved || 0) < qty
        || product.pricePerUnit !== expectedProduct.pricePerUnit) return null;
      product.quantityReserved = (product.quantityReserved || 0) + qty;
      return structuredClone(product);
    },
    async releaseProductQuantity(id, qty) {
      const product = productMap.get(id);
      if (!product || (product.quantityReserved || 0) < qty) throw new Error('invalid reservation release');
      product.quantityReserved -= qty;
      return structuredClone(product);
    },
    async consumeProductReservation(id, qty) {
      const product = productMap.get(id);
      if (!product || (product.quantityReserved || 0) < qty || product.quantityAvailable < qty) {
        throw new Error('invalid reservation consumption');
      }
      product.quantityReserved -= qty;
      product.quantityAvailable -= qty;
      return structuredClone(product);
    }
  };
  const orderStore = {
    async insertOrder(order) {
      insertAttempts += 1;
      if (insertAttempts === failInsertAt) throw new Error('simulated order persistence failure');
      orders.set(order.id, structuredClone(order));
      return order;
    },
    async deleteOrder(id) {
      const order = orders.get(id) || null;
      orders.delete(id);
      return order;
    },
    async getOrderById(id) {
      return structuredClone(orders.get(id) || null);
    },
    async listOrdersForBuyer(uid) {
      return [...orders.values()].filter((order) => order.buyerUid === uid);
    },
    async listOrdersForSeller(uid) {
      return [...orders.values()].filter((order) => order.items.some((item) => item.sellerUid === uid));
    },
    async updateOrder(id, expectedStatus, update) {
      const order = orders.get(id);
      if (!order || order.status !== expectedStatus) return null;
      const saved = { ...order, ...structuredClone(update) };
      orders.set(id, saved);
      return structuredClone(saved);
    },
    async listExpiredPendingOrders(now) {
      return [...orders.values()].filter((order) => (
        order.status === 'pending_payment' && order.reservationExpiresAt <= now
      ));
    }
  };
  const service = createOrderService({ productStore, orderStore });
  const authMiddleware = (req, _res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    req.user = users[token] || null;
    if (!req.user) {
      const error = new Error('Sign in to continue.');
      error.status = 401;
      error.code = 'UNAUTHENTICATED';
      return next(error);
    }
    next();
  };
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', createOrderRouter({
    service,
    store: orderStore,
    authMiddleware,
    requireSellerMiddleware: (_req, _res, next) => next()
  }));
  app.use(createErrorHandler({ isProduction: true }));
  return { app, orders, productMap, service };
}

function product(id, sellerUid, { pricePerUnit = 15, quantityAvailable = 10, quantityReserved = 0 } = {}) {
  return {
    id,
    sellerUid,
    title: `Fresh ${id}`,
    status: 'active',
    unit: 'kg',
    minOrder: 0.1,
    pricePerUnit,
    quantityAvailable,
    quantityReserved
  };
}

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

const requestDelivery = {
  method: 'seller_delivery',
  county: 'Kiambu',
  town: 'Ruiru',
  phone: '+254712345678',
  notes: 'Call on arrival'
};

test('checkout splits sellers, snapshots server prices, rounds each line to whole KES, and reserves stock', async (context) => {
  const harness = makeHarness({
    products: [
      product('prod-a', 'seller-a', { pricePerUnit: 15 }),
      product('prod-b', 'seller-b', { pricePerUnit: 25 })
    ]
  });
  const server = await listen(harness.app);
  context.after(server.close);

  const response = await fetch(`${server.url}/api/orders`, {
    method: 'POST',
    headers: { Authorization: 'Bearer buyer', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: 'prod-a', qty: 0.1 }, { productId: 'prod-b', qty: 0.1 }],
      delivery: requestDelivery
    })
  });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.orders.length, 2);
  assert.equal(new Set(payload.orders.map((order) => order.items[0].sellerUid)).size, 2);
  assert.deepEqual(payload.orders.map((order) => order.total), [2, 3]);
  assert.ok(payload.orders.every((order) => order.status === 'pending_payment' && order.deliveryFee === 0));
  assert.ok(payload.orders.every((order) => order.delivery.notes === 'Call on arrival'));
  assert.equal(harness.productMap.get('prod-a').quantityReserved, 0.1);
  assert.equal(harness.productMap.get('prod-b').quantityReserved, 0.1);
});

test('checkout rejects client prices, seller minimum violations, and insufficient stock without partial reservations', async () => {
  const harness = makeHarness({
    products: [
      product('prod-a', 'seller-a', { quantityAvailable: 1 }),
      product('prod-b', 'seller-b', { quantityAvailable: 0.25 })
    ]
  });
  const base = {
    items: [{ productId: 'prod-a', qty: 0.5 }, { productId: 'prod-b', qty: 0.5 }],
    delivery: requestDelivery
  };
  await assert.rejects(
    harness.service.createCheckoutOrders({ buyerUid: 'buyer-1', ...base }),
    (error) => error.code === 'INSUFFICIENT_STOCK'
  );
  assert.equal(harness.productMap.get('prod-a').quantityReserved, 0);
  assert.equal(harness.orders.size, 0);
  await assert.rejects(
    harness.service.createCheckoutOrders({
      buyerUid: 'buyer-1',
      items: [{ productId: 'prod-a', qty: 0.05 }],
      delivery: requestDelivery
    }),
    (error) => error.code === 'MINIMUM_ORDER'
  );

  const server = await listen(harness.app);
  try {
    const altered = await fetch(`${server.url}/api/orders`, {
      method: 'POST',
      headers: { Authorization: 'Bearer buyer', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, items: [{ productId: 'prod-a', qty: 1, unitPrice: 1 }] })
    });
    assert.equal(altered.status, 400);
  } finally {
    await server.close();
  }
});

test('checkout insertion failure removes earlier seller orders and releases all reservations', async () => {
  const harness = makeHarness({
    failInsertAt: 2,
    products: [product('prod-a', 'seller-a'), product('prod-b', 'seller-b')]
  });
  await assert.rejects(
    harness.service.createCheckoutOrders({
      buyerUid: 'buyer-1',
      items: [{ productId: 'prod-a', qty: 1 }, { productId: 'prod-b', qty: 1 }],
      delivery: requestDelivery
    }),
    /simulated order persistence failure/
  );
  assert.equal(harness.orders.size, 0);
  assert.equal(harness.productMap.get('prod-a').quantityReserved, 0);
  assert.equal(harness.productMap.get('prod-b').quantityReserved, 0);
});

test('buyer cancellation releases stock; other users cannot read or cancel the order', async (context) => {
  const harness = makeHarness({ products: [product('prod-a', 'seller-a')] });
  const server = await listen(harness.app);
  context.after(server.close);
  const checkout = await fetch(`${server.url}/api/orders`, {
    method: 'POST',
    headers: { Authorization: 'Bearer buyer', 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: 'prod-a', qty: 1 }], delivery: requestDelivery })
  });
  const [{ id }] = (await checkout.json()).orders;

  const denied = await fetch(`${server.url}/api/orders/${id}`, { headers: { Authorization: 'Bearer other' } });
  assert.equal(denied.status, 404);
  const cancelDenied = await fetch(`${server.url}/api/orders/${id}/cancel`, {
    method: 'POST',
    headers: { Authorization: 'Bearer other' }
  });
  assert.equal(cancelDenied.status, 404);

  const cancelled = await fetch(`${server.url}/api/orders/${id}/cancel`, {
    method: 'POST',
    headers: { Authorization: 'Bearer buyer' }
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).order.status, 'cancelled');
  assert.equal(harness.productMap.get('prod-a').quantityReserved, 0);
});

test('seller order lifecycle is owner-only, requires paid status, and buyer can complete delivery', async (context) => {
  const harness = makeHarness({ products: [product('prod-a', 'seller-a')] });
  const server = await listen(harness.app);
  context.after(server.close);
  const checkout = await fetch(`${server.url}/api/orders`, {
    method: 'POST',
    headers: { Authorization: 'Bearer buyer', 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: 'prod-a', qty: 1 }], delivery: requestDelivery })
  });
  const [{ id }] = (await checkout.json()).orders;

  const earlyConfirm = await fetch(`${server.url}/api/orders/${id}/confirm`, {
    method: 'POST',
    headers: { Authorization: 'Bearer sellerA' }
  });
  assert.equal(earlyConfirm.status, 409);
  await harness.orders.set(id, {
    ...harness.orders.get(id),
    status: 'paid',
    statusHistory: [...harness.orders.get(id).statusHistory, { status: 'paid', at: new Date(), by: 'system' }]
  });

  const wrongSeller = await fetch(`${server.url}/api/orders/${id}/confirm`, {
    method: 'POST',
    headers: { Authorization: 'Bearer sellerB' }
  });
  assert.equal(wrongSeller.status, 404);
  for (const action of ['confirm', 'dispatch', 'deliver']) {
    const response = await fetch(`${server.url}/api/orders/${id}/${action}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sellerA' }
    });
    assert.equal(response.status, 200);
  }
  const complete = await fetch(`${server.url}/api/orders/${id}/complete`, {
    method: 'POST',
    headers: { Authorization: 'Bearer buyer' }
  });
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).order.status, 'completed');
  assert.equal(harness.productMap.get('prod-a').quantityAvailable, 9);
  assert.equal(harness.productMap.get('prod-a').quantityReserved, 0);
});

test('expired checkout reservations are cancelled and returned to available stock', async () => {
  const harness = makeHarness({ products: [product('prod-a', 'seller-a')] });
  const now = new Date('2026-10-23T12:00:00.000Z');
  const [order] = await harness.service.createCheckoutOrders({
    buyerUid: 'buyer-1',
    items: [{ productId: 'prod-a', qty: 2 }],
    delivery: requestDelivery,
    now
  });
  assert.equal(harness.productMap.get('prod-a').quantityReserved, 2);
  const count = await harness.service.expireReservations(new Date(now.valueOf() + 16 * 60 * 1000));
  assert.equal(count, 1);
  assert.equal(harness.orders.get(order.id).status, 'cancelled');
  assert.equal(harness.orders.get(order.id).cancellationReason, 'reservation_expired');
  assert.equal(harness.productMap.get('prod-a').quantityReserved, 0);
});

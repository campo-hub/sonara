import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createErrorHandler } from '../src/middleware/errors.js';
import { createPaymentRouter } from '../src/modules/payments/routes.js';
import { createPaymentService } from '../src/modules/payments/service.js';
import { createOrderService } from '../src/modules/orders/service.js';

const paymentId = 'ac6875a8-8e38-4677-8e50-3d8870a60e61';

function makePaymentHarness({
  status = 'COMPLETED',
  providerAmount = '1250.00',
  providerCurrency = 'KES',
  paymentConfig = {
    consumerKey: 'test-key',
    consumerSecret: 'test-secret',
    callbackUrl: 'https://frontend.example.test/payment-result',
    ipnUrl: 'https://api.example.test/api/payments/pesapal/ipn',
    ipnId: 'ipn-1',
    environment: 'sandbox'
  }
} = {}) {
  const order = {
    id: 'f8f2cc79-077b-4278-a8a7-833833e8aa0a',
    buyerUid: 'buyer-1',
    status: 'pending_payment',
    items: [{ productId: 'product-1', qty: 1 }],
    total: 1250,
    delivery: { phone: '+254712345678' },
    reservationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    statusHistory: [{ status: 'pending_payment', at: new Date(), by: 'buyer-1' }]
  };
  const payments = new Map();
  let submitted;
  let statusRequestCount = 0;
  const paymentStore = {
    async insertPayment(payment) {
      payments.set(payment.id, structuredClone(payment));
      return payment;
    },
    async updatePayment(id, update) {
      const existing = payments.get(id);
      if (!existing) return null;
      const saved = { ...existing, ...structuredClone(update) };
      payments.set(id, saved);
      return structuredClone(saved);
    },
    async getLatestPaymentForOrder(orderId) {
      return [...payments.values()].find((payment) => payment.orderId === orderId) || null;
    },
    async getPaymentByMerchantReference(reference) {
      return [...payments.values()].find((payment) => payment.merchantReference === reference) || null;
    },
    async getPaymentByTrackingId(trackingId) {
      return [...payments.values()].find((payment) => payment.orderTrackingId === trackingId) || null;
    }
  };
  const orderStore = {
    async getOrderById(id) {
      return id === order.id ? structuredClone(order) : null;
    },
    async claimPaymentAttempt(id, attemptId) {
      if (id !== order.id || order.status !== 'pending_payment' || order.paymentAttemptId) return null;
      order.paymentAttemptId = attemptId;
      return structuredClone(order);
    },
    async clearPaymentAttempt(id, attemptId) {
      if (id !== order.id || order.paymentAttemptId !== attemptId) return null;
      delete order.paymentAttemptId;
      return structuredClone(order);
    },
    async updateOrder(id, expectedStatus, update, { requireNoPaymentAttempt = false } = {}) {
      if (id !== order.id || order.status !== expectedStatus
        || (requireNoPaymentAttempt && order.paymentAttemptId)) return null;
      Object.assign(order, structuredClone(update));
      return structuredClone(order);
    }
  };
  const provider = {
    async submitOrderRequest(input) {
      submitted = input;
      return {
        orderTrackingId: 'tracking-123',
        merchantReference: input.merchantReference,
        redirectUrl: 'https://cybqa.pesapal.com/pesapalv3/iframe3/example'
      };
    },
    async getTransactionStatus(trackingId) {
      statusRequestCount += 1;
      return {
        merchant_reference: submitted.merchantReference,
        order_tracking_id: trackingId,
        amount: providerAmount,
        currency: providerCurrency,
        payment_status_description: status
      };
    }
  };
  const reservations = {
    async expireReservations() {
      order.status = 'cancelled';
      order.statusHistory.push({ status: 'cancelled', at: new Date(), by: 'system' });
      return 1;
    }
  };
  const service = createPaymentService({
    provider,
    paymentStore,
    orderStore,
    reservations,
    paymentConfig
  });
  const authMiddleware = (req, _res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    req.user = token === 'buyer'
      ? { uid: 'buyer-1', email: 'buyer@example.test', name: 'Buyer Name' }
      : { uid: 'other-user', email: 'other@example.test', name: '' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createPaymentRouter({ service, authMiddleware }));
  app.use(createErrorHandler({ isProduction: true }));
  return {
    app,
    order,
    payments,
    submitted: () => submitted,
    statusRequestCount: () => statusRequestCount,
    service
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

test('buyer starts one PesaPal hosted checkout and retries reuse its redirect URL', async (context) => {
  const harness = makePaymentHarness();
  const server = await listen(harness.app);
  context.after(server.close);

  const start = () => fetch(`${server.url}/api/orders/f8f2cc79-077b-4278-a8a7-833833e8aa0a/payment`, {
    method: 'POST',
    headers: { Authorization: 'Bearer buyer', 'Content-Type': 'application/json' },
    body: '{}'
  });
  const firstResponse = await start();
  const first = await firstResponse.json();
  const secondResponse = await start();
  const second = await secondResponse.json();

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(first.redirectUrl, 'https://cybqa.pesapal.com/pesapalv3/iframe3/example');
  assert.equal(first.paymentId, second.paymentId);
  assert.equal(second.reused, true);
  assert.equal(harness.payments.size, 1);
  assert.equal(harness.submitted().amount, 1250);
  assert.equal(harness.submitted().billingAddress.email_address, 'buyer@example.test');
  assert.equal(harness.submitted().billingAddress.phone_number, '+254712345678');
  assert.equal(harness.submitted().id, [...harness.payments.values()][0].merchantReference);
});

test('payment initiation is buyer-owned, requires a valid email and an active reservation', async () => {
  const harness = makePaymentHarness();
  await assert.rejects(
    harness.service.startPayment({
      orderId: 'f8f2cc79-077b-4278-a8a7-833833e8aa0a',
      buyerUid: 'other-user',
      email: 'buyer@example.test'
    }),
    (error) => error.status === 404
  );

  const invalidEmailHarness = makePaymentHarness();
  await assert.rejects(
    invalidEmailHarness.service.startPayment({
      orderId: 'f8f2cc79-077b-4278-a8a7-833833e8aa0a',
      buyerUid: 'buyer-1',
      email: 'not-an-email'
    }),
    (error) => error.code === 'PAYMENT_EMAIL_REQUIRED'
  );

  const expiredHarness = makePaymentHarness();
  expiredHarness.order.reservationExpiresAt = new Date(Date.now() - 1000);
  await assert.rejects(
    expiredHarness.service.startPayment({
      orderId: 'f8f2cc79-077b-4278-a8a7-833833e8aa0a',
      buyerUid: 'buyer-1',
      email: 'buyer@example.test'
    }),
    (error) => error.code === 'RESERVATION_EXPIRED'
  );
});

test('payment initiation requires configuration and order cancellation cannot race an in-flight payment attempt', async () => {
  const disabled = makePaymentHarness({ paymentConfig: {} });
  await assert.rejects(
    disabled.service.startPayment({
      orderId: 'f8f2cc79-077b-4278-a8a7-833833e8aa0a',
      buyerUid: 'buyer-1',
      email: 'buyer@example.test'
    }),
    (error) => error.code === 'PAYMENTS_NOT_CONFIGURED'
  );
  assert.equal(disabled.payments.size, 0);

  const inFlight = makePaymentHarness();
  inFlight.order.paymentAttemptId = 'active-payment';
  const orderService = createOrderService({
    productStore: {},
    orderStore: {
      getOrderById: async () => structuredClone(inFlight.order),
      updateOrder: async (id, status, update, options) => {
        if (options?.requireNoPaymentAttempt && inFlight.order.paymentAttemptId) return null;
        if (id !== inFlight.order.id || status !== inFlight.order.status) return null;
        Object.assign(inFlight.order, update);
        return inFlight.order;
      }
    }
  });
  await assert.rejects(
    orderService.cancelOrder(inFlight.order, 'buyer-1'),
    (error) => error.code === 'PAYMENT_IN_PROGRESS'
  );
  assert.equal(inFlight.order.status, 'pending_payment');
});

test('cancelling an already-paid order flags it for manual refund review', async () => {
  const harness = makePaymentHarness();
  harness.order.status = 'paid';
  harness.order.statusHistory.push({ status: 'paid', at: new Date(), by: 'pesapal' });
  const orderService = createOrderService({
    productStore: { releaseProductQuantity: async () => ({}) },
    orderStore: {
      getOrderById: async () => structuredClone(harness.order),
      updateOrder: async (id, status, update, options) => {
        if (options?.requireNoPaymentAttempt && harness.order.paymentAttemptId) return null;
        if (id !== harness.order.id || status !== harness.order.status) return null;
        Object.assign(harness.order, update);
        return structuredClone(harness.order);
      }
    }
  });
  const cancelled = await orderService.cancelOrder(harness.order, 'buyer-1');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.refundReviewRequired, true);
});

test('IPN verifies transaction status, amount, currency and merchant reference before marking paid', async (context) => {
  const harness = makePaymentHarness();
  const server = await listen(harness.app);
  context.after(server.close);
  const started = await harness.service.startPayment({
    orderId: 'f8f2cc79-077b-4278-a8a7-833833e8aa0a',
    buyerUid: 'buyer-1',
    email: 'buyer@example.test'
  });
  const reference = harness.submitted().merchantReference;
  const callbackUrl = `${server.url}/api/payments/pesapal/ipn?OrderTrackingId=tracking-123&OrderMerchantReference=${encodeURIComponent(reference)}`;
  const response = await fetch(callbackUrl);
  const result = await response.json();
  const duplicate = await fetch(callbackUrl);

  assert.equal(response.status, 200);
  assert.equal(result.status, 'completed');
  assert.equal((await duplicate.json()).status, 'completed');
  assert.equal(harness.statusRequestCount(), 2);
  assert.equal(harness.order.status, 'paid');
  assert.equal(harness.order.paymentId, started.paymentId);
  assert.equal(harness.payments.get(started.paymentId).status, 'completed');
  assert.equal(harness.payments.get(started.paymentId).ipnReceivedAt.length, 2);
  assert.equal(harness.order.statusHistory.filter((entry) => entry.status === 'paid').length, 1);
});

test('failed provider status leaves the order unpaid and mismatched notifications are rejected', async () => {
  const harness = makePaymentHarness({ status: 'FAILED' });
  const started = await harness.service.startPayment({
    orderId: 'f8f2cc79-077b-4278-a8a7-833833e8aa0a',
    buyerUid: 'buyer-1',
    email: 'buyer@example.test'
  });
  const reference = harness.submitted().merchantReference;
  await assert.rejects(
    harness.service.processIpn({
      orderTrackingId: 'tracking-123',
      merchantReference: 'unrelated-reference'
    }),
    (error) => error.code === 'PAYMENT_MISMATCH'
  );
  const result = await harness.service.processIpn({
    orderTrackingId: 'tracking-123',
    merchantReference: reference
  });
  assert.equal(result.status, 'failed');
  assert.equal(harness.order.status, 'pending_payment');
  assert.equal(harness.payments.get(started.paymentId).status, 'failed');
});

test('IPN amount or currency mismatch cannot mark the order paid', async () => {
  for (const mismatch of [
    { providerAmount: '1249.00', providerCurrency: 'KES' },
    { providerAmount: '1250.00', providerCurrency: 'USD' }
  ]) {
    const harness = makePaymentHarness(mismatch);
    await harness.service.startPayment({
      orderId: 'f8f2cc79-077b-4278-a8a7-833833e8aa0a',
      buyerUid: 'buyer-1',
      email: 'buyer@example.test'
    });
    await assert.rejects(
      harness.service.processIpn({
        orderTrackingId: 'tracking-123',
        merchantReference: harness.submitted().merchantReference
      }),
      (error) => error.code === 'PAYMENT_MISMATCH'
    );
    assert.equal(harness.order.status, 'pending_payment');
  }
});

test('successful payment after reservation expiry is marked for manual order review', async () => {
  const harness = makePaymentHarness();
  await harness.service.startPayment({
    orderId: 'f8f2cc79-077b-4278-a8a7-833833e8aa0a',
    buyerUid: 'buyer-1',
    email: 'buyer@example.test'
  });
  harness.order.reservationExpiresAt = new Date(Date.now() - 1000);
  const result = await harness.service.processIpn({
    orderTrackingId: 'tracking-123',
    merchantReference: harness.submitted().merchantReference
  });
  assert.equal(result.status, 'completed');
  assert.equal(harness.order.status, 'disputed');
  assert.equal(harness.payments.values().next().value.status, 'completed');
});

test('PesaPal OAuth, IPN registration, and hosted-order request use the selected API environment', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    if (parsed.pathname.endsWith('/Auth/RequestToken')) {
      return Response.json({ token: 'provider-token', expiryDate: '2099-01-01T00:00:00Z' });
    }
    if (parsed.pathname.endsWith('/URLSetup/RegisterIPN')) {
      return Response.json({ ipn_id: 'registered-ipn' });
    }
    if (parsed.pathname.endsWith('/Transactions/SubmitOrderRequest')) {
      assert.equal(init.headers.Authorization, 'Bearer provider-token');
      assert.equal(body.notification_id, 'registered-ipn');
      return Response.json({
        merchant_reference: body.id,
        order_tracking_id: 'tracking-ref',
        redirect_url: 'https://cybqa.pesapal.com/pesapalv3/iframe3/test'
      });
    }
    throw new Error(`Unexpected request path: ${parsed.pathname}`);
  };
  const { createPesapalClient } = await import('../src/modules/payments/pesapal.js');
  const client = createPesapalClient({
    pesapalConfig: {
      environment: 'sandbox',
      consumerKey: 'key',
      consumerSecret: 'secret',
      callbackUrl: 'https://web.example.test/payment',
      ipnUrl: 'https://api.example.test/api/payments/pesapal/ipn',
      ipnId: 'registered-ipn'
    },
    fetchImpl
  });
  const result = await client.submitOrderRequest({
    id: paymentId,
    merchantReference: paymentId,
    amount: 1250,
    description: 'AgriStore test order',
    billingAddress: { email_address: 'buyer@example.test', phone_number: '+254712345678' }
  });
  assert.equal(result.orderTrackingId, 'tracking-ref');
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.url.startsWith('https://cybqa.pesapal.com/pesapalv3/')));
});

test('PesaPal IPN registration returns the ID that is configured for later starts', async () => {
  const { createPesapalClient } = await import('../src/modules/payments/pesapal.js');
  const requests = [];
  const client = createPesapalClient({
    pesapalConfig: {
      environment: 'sandbox',
      consumerKey: 'key',
      consumerSecret: 'secret',
      callbackUrl: 'https://web.example.test/payment',
      ipnUrl: 'https://api.example.test/api/payments/pesapal/ipn',
      ipnId: ''
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/api/Auth/RequestToken')) return Response.json({ token: 'provider-token' });
      return Response.json({ ipn_id: 'registered-ipn' });
    }
  });
  assert.equal(await client.registerIpnUrl(), 'registered-ipn');
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[1].init.body).ipn_notification_type, 'GET');
});

test('PesaPal client rejects non-provider checkout redirects and missing credentials', async () => {
  const { createPesapalClient } = await import('../src/modules/payments/pesapal.js');
  const client = createPesapalClient({
    pesapalConfig: {
      environment: 'sandbox',
      consumerKey: 'key',
      consumerSecret: 'secret',
      callbackUrl: 'https://web.example.test/payment',
      ipnUrl: 'https://api.example.test/ipn',
      ipnId: 'registered'
    },
    fetchImpl: async () => Response.json({
      merchant_reference: paymentId,
      order_tracking_id: 'tracking-ref',
      redirect_url: 'https://evil.example.test/phishing'
    })
  });
  await assert.rejects(
    client.submitOrderRequest({
      id: paymentId,
      merchantReference: paymentId,
      amount: 1250,
      description: 'Test',
      billingAddress: { email_address: 'buyer@example.test' }
    }),
    (error) => error.code === 'PAYMENT_PROVIDER_ERROR'
  );

  const unconfigured = createPesapalClient({
    pesapalConfig: { environment: 'sandbox', consumerKey: '', consumerSecret: '' },
    fetchImpl: async () => {
      throw new Error('fetch must not be called');
    }
  });
  await assert.rejects(unconfigured.getAccessToken(), (error) => error.code === 'PAYMENTS_NOT_CONFIGURED');
});

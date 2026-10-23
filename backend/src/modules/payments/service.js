import { randomUUID } from 'node:crypto';
import { config } from '../../config.js';
import { HttpError } from '../../middleware/errors.js';
import { validatePayment } from '../../models/marketplace.js';
import { getOrderById, updateOrder, claimPaymentAttempt, clearPaymentAttempt } from '../orders/store.js';
import { orderService } from '../orders/service.js';
import { pesapalClient } from './pesapal.js';
import {
  getLatestPaymentForOrder,
  getPaymentByMerchantReference,
  getPaymentByTrackingId,
  insertPayment,
  updatePayment
} from './store.js';

function normalizeProviderStatus(result) {
  const description = String(result.payment_status_description || '').trim().toUpperCase();
  const code = String(result.status_code ?? result.payment_status_code ?? '').trim();
  if (description === 'COMPLETED' || code === '1') return 'completed';
  if (description === 'FAILED' || code === '2') return 'failed';
  if (description === 'REVERSED' || code === '3') return 'reversed';
  if (description === 'INVALID' || code === '0') return 'invalid';
  return 'pending';
}

function safeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function requireValidPayment(payment) {
  const validationError = validatePayment(payment);
  if (validationError) throw new Error(`Payment operation produced invalid data: ${validationError}`);
}

export function createPaymentService({
  provider = pesapalClient,
  paymentStore = {
    insertPayment,
    updatePayment,
    getPaymentByMerchantReference,
    getPaymentByTrackingId,
    getLatestPaymentForOrder
  },
  orderStore = { getOrderById, updateOrder, claimPaymentAttempt, clearPaymentAttempt },
  reservations = orderService,
  paymentConfig = config.pesapal,
  now = () => new Date()
} = {}) {
  async function startPayment({ orderId, buyerUid, email, displayName = '', phone }) {
    const order = await orderStore.getOrderById(orderId);
    if (!order || order.buyerUid !== buyerUid) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    if (!paymentConfig.consumerKey || !paymentConfig.consumerSecret
      || !paymentConfig.callbackUrl || !paymentConfig.ipnUrl || !paymentConfig.ipnId) {
      throw new HttpError(503, 'Online payments are not configured.', 'PAYMENTS_NOT_CONFIGURED');
    }
    if (order.status !== 'pending_payment') {
      throw new HttpError(409, 'Only unpaid orders can start payment.', 'ORDER_NOT_PAYABLE');
    }
    const startedAt = now();
    if (new Date(order.reservationExpiresAt) <= startedAt) {
      await reservations.expireReservations(startedAt);
      throw new HttpError(409, 'This order reservation has expired. Please check out again.', 'RESERVATION_EXPIRED');
    }
    const billingEmail = safeEmail(email);
    if (!billingEmail) throw new HttpError(400, 'A valid email address is required for payment.', 'PAYMENT_EMAIL_REQUIRED');
    const existing = await paymentStore.getLatestPaymentForOrder(order.id);
    if (existing && ['created', 'pending', 'completed'].includes(existing.status)) {
      if (existing.redirectUrl && existing.status === 'pending') {
        return { paymentId: existing.id, redirectUrl: existing.redirectUrl, reused: true };
      }
      throw new HttpError(409, 'A payment attempt is already being processed for this order.', 'PAYMENT_IN_PROGRESS');
    }

    const id = randomUUID();
    const claimedOrder = await orderStore.claimPaymentAttempt(order.id, id);
    if (!claimedOrder) throw new HttpError(409, 'A payment attempt is already being processed for this order.', 'PAYMENT_IN_PROGRESS');

    const payment = {
      id,
      orderId: order.id,
      provider: 'pesapal',
      status: 'created',
      merchantReference: `pay_${randomUUID().replaceAll('-', '')}`,
      amount: order.total,
      currency: 'KES',
      createdAt: startedAt,
      updatedAt: startedAt,
      ipnReceivedAt: []
    };
    requireValidPayment(payment);
    let stored;
    try {
      stored = await paymentStore.insertPayment(payment);
    } catch (error) {
      try {
        await orderStore.clearPaymentAttempt(order.id, id);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Payment record creation failed and the order payment lock could not be cleared.');
      }
      throw error;
    }

    try {
      const result = await provider.submitOrderRequest({
        id: payment.merchantReference,
        merchantReference: payment.merchantReference,
        amount: payment.amount,
        description: `AgriStore order ${order.id}`,
        billingAddress: {
          email_address: billingEmail,
          phone_number: phone || order.delivery.phone,
          country_code: 'KE',
          first_name: String(displayName || '').trim().slice(0, 50) || 'AgriStore',
          last_name: 'Buyer'
        }
      });
      const updated = await paymentStore.updatePayment(stored.id, {
        status: 'pending',
        orderTrackingId: result.orderTrackingId,
        redirectUrl: result.redirectUrl,
        updatedAt: now()
      });
      if (!updated) throw new Error('Payment record disappeared after provider checkout creation.');
      requireValidPayment(updated);
      await orderStore.clearPaymentAttempt(order.id, id);
      return { paymentId: updated.id, redirectUrl: updated.redirectUrl, reused: false };
    } catch (error) {
      const failedStatus = error instanceof HttpError
        && (error.code === 'PAYMENTS_NOT_CONFIGURED' || error.status === 502)
        ? 'failed'
        : 'pending';
      const updateError = await paymentStore.updatePayment(stored.id, {
        status: failedStatus,
        updatedAt: now()
      }).then(() => null, (failure) => failure);
      const clearError = await orderStore.clearPaymentAttempt(order.id, id).then(() => null, (failure) => failure);
      if (updateError || clearError) {
        throw new AggregateError(
          [error, ...[updateError, clearError].filter(Boolean)],
          'Payment initiation failed and could not fully update its state.'
        );
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Payment provider could not start checkout. Check the order payment status before retrying.', 'PAYMENT_PROVIDER_ERROR');
    }
  }

  async function applyVerifiedStatus(payment, result, trackingId) {
    if (result.merchant_reference !== payment.merchantReference
      || Number(result.amount) !== payment.amount
      || String(result.currency || '').toUpperCase() !== payment.currency) {
      throw new HttpError(502, 'Payment provider transaction details did not match the order.', 'PAYMENT_MISMATCH');
    }
    const status = normalizeProviderStatus(result);
    const timestamp = now();
    const ipnReceivedAt = [...(payment.ipnReceivedAt || []), timestamp].slice(-20);
    const updatedPayment = await paymentStore.updatePayment(payment.id, {
      status,
      orderTrackingId: trackingId,
      providerStatus: String(result.payment_status_description || status).slice(0, 50),
      updatedAt: timestamp,
      ipnReceivedAt
    });
    if (!updatedPayment) throw new Error('Payment record disappeared while applying provider status.');
    requireValidPayment(updatedPayment);

    const order = await orderStore.getOrderById(payment.orderId);
    if (!order) throw new HttpError(404, 'Order not found for payment.', 'ORDER_NOT_FOUND');
    if (status === 'completed') {
      if (order.status === 'pending_payment' && new Date(order.reservationExpiresAt) > timestamp) {
        const paid = await orderStore.updateOrder(order.id, 'pending_payment', {
          status: 'paid',
          updatedAt: timestamp,
          paymentId: payment.id,
          statusHistory: [...order.statusHistory, { status: 'paid', at: timestamp, by: 'pesapal' }]
        });
        if (!paid) {
          const latest = await orderStore.getOrderById(order.id);
          if (latest?.status !== 'paid') throw new HttpError(409, 'Payment was confirmed but the order state needs review.', 'PAYMENT_ORDER_REVIEW');
        }
      } else if (order.status !== 'paid' && order.status !== 'confirmed'
        && order.status !== 'dispatched' && order.status !== 'delivered' && order.status !== 'completed'
        && order.status !== 'disputed') {
        if (order.status === 'pending_payment') await reservations.expireReservations(timestamp);
        const latest = await orderStore.getOrderById(order.id);
        if (latest && ['cancelled', 'pending_payment'].includes(latest.status)) {
          await orderStore.updateOrder(latest.id, latest.status, {
            status: 'disputed',
            updatedAt: timestamp,
            paymentId: payment.id,
            statusHistory: [...latest.statusHistory, { status: 'disputed', at: timestamp, by: 'pesapal' }]
          });
        }
      }
    } else if (status === 'reversed'
      && ['paid', 'confirmed', 'dispatched', 'delivered', 'completed'].includes(order.status)) {
      await orderStore.updateOrder(order.id, order.status, {
        status: 'disputed',
        updatedAt: timestamp,
        statusHistory: [...order.statusHistory, { status: 'disputed', at: timestamp, by: 'pesapal' }]
      });
    }
    return { status, paymentId: payment.id, orderId: payment.orderId };
  }

  async function processIpn({ orderTrackingId, merchantReference }) {
    if (typeof orderTrackingId !== 'string' || !orderTrackingId
      || typeof merchantReference !== 'string' || !merchantReference) {
      throw new HttpError(400, 'Payment notification identifiers are required.', 'INVALID_PAYMENT_NOTIFICATION');
    }
    const byReference = await paymentStore.getPaymentByMerchantReference(merchantReference);
    const byTracking = await paymentStore.getPaymentByTrackingId(orderTrackingId);
    const payment = byReference || byTracking;
    if (!payment || (byReference && byTracking && byReference.id !== byTracking.id)) {
      throw new HttpError(404, 'Payment attempt not found.', 'PAYMENT_NOT_FOUND');
    }
    if (payment.merchantReference !== merchantReference
      || (payment.orderTrackingId && payment.orderTrackingId !== orderTrackingId)) {
      throw new HttpError(400, 'Payment notification does not match the payment attempt.', 'PAYMENT_MISMATCH');
    }
    const result = await provider.getTransactionStatus(orderTrackingId);
    return applyVerifiedStatus(payment, result, orderTrackingId);
  }

  async function getOrderPayment({ orderId, buyerUid }) {
    const order = await orderStore.getOrderById(orderId);
    if (!order || order.buyerUid !== buyerUid) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    const payment = await paymentStore.getLatestPaymentForOrder(order.id);
    if (!payment) return null;
    return {
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      redirectUrl: payment.status === 'pending' ? payment.redirectUrl : undefined,
      createdAt: payment.createdAt
    };
  }

  return { startPayment, processIpn, getOrderPayment };
}

export const paymentService = createPaymentService();

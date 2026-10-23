import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { paymentService } from './service.js';

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function queryString(query, ...keys) {
  for (const key of keys) {
    const value = query[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function createPaymentRouter({
  service = paymentService,
  authMiddleware = requireAuth
} = {}) {
  const router = Router();

  router.post('/orders/:id/payment', authMiddleware, asyncRoute(async (req, res) => {
    if (Object.keys(req.body || {}).length) {
      throw new HttpError(400, 'Payment initiation does not accept a request body.', 'INVALID_PAYMENT_REQUEST');
    }
    const result = await service.startPayment({
      orderId: req.params.id,
      buyerUid: req.user.uid,
      email: req.user.email,
      displayName: req.user.name
    });
    res.set('Cache-Control', 'private, no-store').status(200).json(result);
  }));

  router.get('/orders/:id/payment', authMiddleware, asyncRoute(async (req, res) => {
    const payment = await service.getOrderPayment({ orderId: req.params.id, buyerUid: req.user.uid });
    res.set('Cache-Control', 'private, no-store').json({ payment });
  }));

  router.get('/payments/pesapal/ipn', asyncRoute(async (req, res) => {
    const result = await service.processIpn({
      orderTrackingId: queryString(req.query, 'OrderTrackingId', 'orderTrackingId'),
      merchantReference: queryString(req.query, 'OrderMerchantReference', 'orderMerchantReference')
    });
    res.set('Cache-Control', 'no-store').status(200).json({ acknowledged: true, status: result.status });
  }));

  return router;
}

export default createPaymentRouter();

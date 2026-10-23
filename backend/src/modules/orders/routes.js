import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { requireRole } from '../../middleware/roles.js';
import { validateOrder } from '../../models/marketplace.js';
import { orderService } from './service.js';
import {
  getOrderById,
  listOrdersForBuyer,
  listOrdersForSeller,
  updateOrder
} from './store.js';
import { parseCheckoutRequest } from './validation.js';

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function isSellerOrder(order, uid) {
  return order.items.some((item) => item.sellerUid === uid);
}

export function createOrderRouter({
  service = orderService,
  store = { getOrderById, listOrdersForBuyer, listOrdersForSeller, updateOrder },
  authMiddleware = requireAuth,
  requireSellerMiddleware = requireRole('seller')
} = {}) {
  const router = Router();

  router.post('/orders', authMiddleware, asyncRoute(async (req, res) => {
    const checkout = parseCheckoutRequest(req.body);
    const orders = await service.createCheckoutOrders({
      buyerUid: req.user.uid,
      ...checkout
    });
    res.set('Cache-Control', 'private, no-store').status(201).json({ orders });
  }));

  router.get('/orders', authMiddleware, asyncRoute(async (req, res) => {
    const orders = await store.listOrdersForBuyer(req.user.uid);
    res.set('Cache-Control', 'private, no-store').json({ orders });
  }));

  router.get('/seller/orders', authMiddleware, requireSellerMiddleware, asyncRoute(async (req, res) => {
    const orders = await store.listOrdersForSeller(req.user.uid);
    res.set('Cache-Control', 'private, no-store').json({ orders });
  }));

  router.get('/orders/:id', authMiddleware, asyncRoute(async (req, res) => {
    const order = await store.getOrderById(req.params.id);
    if (!order) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    if (order.buyerUid !== req.user.uid && !isSellerOrder(order, req.user.uid)) {
      throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    }
    res.set('Cache-Control', 'private, no-store').json({ order });
  }));

  router.post('/orders/:id/cancel', authMiddleware, asyncRoute(async (req, res) => {
    const order = await store.getOrderById(req.params.id);
    if (!order || order.buyerUid !== req.user.uid) {
      throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    }
    if (!['pending_payment', 'paid'].includes(order.status)) {
      throw new HttpError(409, 'Orders can only be cancelled before seller confirmation.', 'ORDER_CANNOT_BE_CANCELLED');
    }
    const cancelled = await service.cancelOrder(order, req.user.uid);
    res.set('Cache-Control', 'private, no-store').json({ order: cancelled });
  }));

  const transitions = [
    { action: 'confirm', from: 'paid', to: 'confirmed', role: 'seller' },
    { action: 'dispatch', from: 'confirmed', to: 'dispatched', role: 'seller' },
    { action: 'deliver', from: 'dispatched', to: 'delivered', role: 'seller' },
    { action: 'complete', from: 'delivered', to: 'completed', role: 'buyer' }
  ];
  const transitionLabels = {
    confirm: 'confirmed',
    dispatch: 'dispatched',
    deliver: 'delivered',
    complete: 'completed'
  };
  for (const transition of transitions) {
    router.post(`/orders/:id/${transition.action}`, authMiddleware, ...(transition.role === 'seller' ? [requireSellerMiddleware] : []), asyncRoute(async (req, res) => {
      const order = await store.getOrderById(req.params.id);
      if (!order) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
      const authorized = transition.role === 'buyer'
        ? order.buyerUid === req.user.uid
        : isSellerOrder(order, req.user.uid);
      if (!authorized) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
      if (order.status !== transition.from) {
        throw new HttpError(409, `Only ${transition.from} orders can be ${transitionLabels[transition.action]}.`, 'INVALID_ORDER_STATE');
      }
      if (transition.action === 'complete') {
        const completed = await service.completeOrder(order, req.user.uid);
        const validationError = validateOrder(completed);
        if (validationError) throw new Error(`Order transition produced invalid data: ${validationError}`);
        res.set('Cache-Control', 'private, no-store').json({ order: completed });
        return;
      }
      const now = new Date();
      const updated = await store.updateOrder(order.id, transition.from, {
        status: transition.to,
        updatedAt: now,
        statusHistory: [...order.statusHistory, { status: transition.to, at: now, by: req.user.uid }]
      });
      if (!updated) throw new HttpError(409, 'The order changed; refresh and try again.', 'ORDER_STATE_CHANGED');
      const validationError = validateOrder(updated);
      if (validationError) throw new Error(`Order transition produced invalid data: ${validationError}`);
      res.set('Cache-Control', 'private, no-store').json({ order: updated });
    }));
  }

  return router;
}

export default createOrderRouter();

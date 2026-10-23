import { randomUUID } from 'node:crypto';
import { HttpError } from '../../middleware/errors.js';
import { validateOrder } from '../../models/marketplace.js';
import {
  getProductById,
  consumeProductReservation,
  releaseProductQuantity,
  reserveProductQuantity
} from '../products/store.js';
import {
  deleteOrder,
  insertOrder,
  listExpiredPendingOrders,
  updateOrder
} from './store.js';

const RESERVATION_MINUTES = 15;

function createOrderSnapshot({ buyerUid, products, delivery, now }) {
  const id = randomUUID();
  const items = products.map(({ product, qty }) => {
    const lineTotal = Math.round(product.pricePerUnit * qty);
    if (!Number.isSafeInteger(lineTotal) || lineTotal < 1) {
      throw new HttpError(400, 'Each order line must total at least KES 1.', 'INVALID_ORDER_TOTAL');
    }
    return {
      productId: product.id,
      sellerUid: product.sellerUid,
      titleSnapshot: product.title,
      unit: product.unit,
      qty,
      unitPrice: product.pricePerUnit,
      lineTotal
    };
  });
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!Number.isSafeInteger(subtotal)) {
    throw new HttpError(400, 'Order total exceeds the supported KES amount.', 'INVALID_ORDER_TOTAL');
  }
  const order = {
    id,
    buyerUid,
    status: 'pending_payment',
    items,
    subtotal,
    deliveryFee: 0,
    total: subtotal,
    delivery,
    merchantReference: `ord_${randomUUID().replaceAll('-', '')}`,
    statusHistory: [{ status: 'pending_payment', at: now, by: buyerUid }],
    createdAt: now,
    updatedAt: now,
    reservationExpiresAt: new Date(now.valueOf() + RESERVATION_MINUTES * 60 * 1000)
  };
  const error = validateOrder(order);
  if (error) throw new Error(`Checkout generated an invalid order: ${error}`);
  return order;
}

async function releaseOrderReservations(order, productStore) {
  for (const item of order.items) {
    await productStore.releaseProductQuantity(item.productId, item.qty);
  }
}

export function createOrderService({
  productStore = { getProductById, reserveProductQuantity, releaseProductQuantity, consumeProductReservation },
  orderStore = { insertOrder, deleteOrder, updateOrder, listExpiredPendingOrders }
} = {}) {
  async function expireReservations(now = new Date()) {
    const expired = await orderStore.listExpiredPendingOrders(now);
    for (const order of expired) {
      const updated = await orderStore.updateOrder(order.id, 'pending_payment', {
        status: 'cancelled',
        cancellationReason: 'reservation_expired',
        updatedAt: now,
        statusHistory: [...order.statusHistory, { status: 'cancelled', at: now, by: 'system' }]
      });
      if (updated) await releaseOrderReservations(order, productStore);
    }
    return expired.length;
  }

  async function createCheckoutOrders({ buyerUid, items, delivery, now = new Date() }) {
    await expireReservations(now);
    const quantities = new Map();
    for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.qty);
    const products = [];
    for (const [productId, qty] of quantities) {
      const product = await productStore.getProductById(productId);
      if (!product || product.status !== 'active') {
        throw new HttpError(409, 'A selected product is no longer available.', 'PRODUCT_UNAVAILABLE');
      }
      if (product.sellerUid === buyerUid) {
        throw new HttpError(400, 'You cannot order your own listing.', 'OWN_PRODUCT');
      }
      if (qty < product.minOrder) {
        throw new HttpError(400, `${product.title} does not meet the seller minimum order quantity.`, 'MINIMUM_ORDER');
      }
      products.push({ product, qty });
    }
    const grouped = new Map();
    for (const item of products) {
      const current = grouped.get(item.product.sellerUid) || [];
      current.push(item);
      grouped.set(item.product.sellerUid, current);
    }
    const reserved = [];
    const created = [];
    try {
      for (const item of [...products].sort((a, b) => a.product.id.localeCompare(b.product.id))) {
        const product = await productStore.reserveProductQuantity(item.product.id, item.qty, item.product);
        if (!product) {
          const latest = await productStore.getProductById(item.product.id);
          if (latest?.status === 'active'
            && latest.quantityAvailable - (latest.quantityReserved || 0) >= item.qty
            && (latest.sellerUid !== item.product.sellerUid
              || latest.title !== item.product.title
              || latest.unit !== item.product.unit
              || latest.pricePerUnit !== item.product.pricePerUnit
              || latest.minOrder !== item.product.minOrder)) {
            throw new HttpError(409, 'A selected product changed during checkout. Review the cart and try again.', 'PRODUCT_CHANGED');
          }
          throw new HttpError(409, 'A selected product has insufficient available stock.', 'INSUFFICIENT_STOCK');
        }
        reserved.push(item);
      }
      for (const sellerItems of grouped.values()) {
        const order = createOrderSnapshot({ buyerUid, products: sellerItems, delivery, now });
        await orderStore.insertOrder(order);
        created.push(order);
      }
      return created;
    } catch (error) {
      const rollbackErrors = [];
      for (const order of created) {
        try {
          await orderStore.deleteOrder(order.id);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      for (const item of reserved.reverse()) {
        try {
          await productStore.releaseProductQuantity(item.product.id, item.qty);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length) {
        throw new AggregateError([error, ...rollbackErrors], 'Checkout failed and rollback could not fully restore reserved stock.');
      }
      throw error;
    }
  }

  async function cancelOrder(order, actorUid, reason = 'buyer_cancelled') {
    const now = new Date();
    const updated = await orderStore.updateOrder(order.id, order.status, {
      status: 'cancelled',
      cancellationReason: reason,
      updatedAt: now,
      statusHistory: [...order.statusHistory, { status: 'cancelled', at: now, by: actorUid }]
    });
    if (!updated) throw new HttpError(409, 'The order changed; refresh and try again.', 'ORDER_STATE_CHANGED');
    await releaseOrderReservations(order, productStore);
    return updated;
  }

  async function completeOrder(order, actorUid) {
    const now = new Date();
    const updated = await orderStore.updateOrder(order.id, 'delivered', {
      status: 'completed',
      updatedAt: now,
      statusHistory: [...order.statusHistory, { status: 'completed', at: now, by: actorUid }]
    });
    if (!updated) throw new HttpError(409, 'The order changed; refresh and try again.', 'ORDER_STATE_CHANGED');
    for (const item of order.items) {
      await productStore.consumeProductReservation(item.productId, item.qty);
    }
    return updated;
  }

  return { createCheckoutOrders, expireReservations, cancelOrder, completeOrder };
}

export const orderService = createOrderService();

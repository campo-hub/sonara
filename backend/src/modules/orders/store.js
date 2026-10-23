import { getDb, isMongoConfigured } from '../../db.js';

const memoryOrders = new Map();

async function getOrdersCollection() {
  if (!isMongoConfigured()) return null;
  const db = await getDb();
  return db.collection('orders');
}

export async function insertOrder(order) {
  const collection = await getOrdersCollection();
  if (!collection) {
    if (memoryOrders.has(order.id) || [...memoryOrders.values()].some((item) => item.merchantReference === order.merchantReference)) {
      const error = new Error('Order already exists.');
      error.code = 11000;
      throw error;
    }
    memoryOrders.set(order.id, order);
    return order;
  }
  await collection.insertOne(order);
  return order;
}

export async function deleteOrder(id) {
  const collection = await getOrdersCollection();
  if (!collection) {
    const order = memoryOrders.get(id) || null;
    memoryOrders.delete(id);
    return order;
  }
  const result = await collection.findOneAndDelete({ id }, { projection: { _id: 0 } });
  return result || null;
}

export async function getOrderById(id) {
  const collection = await getOrdersCollection();
  if (!collection) return memoryOrders.get(id) || null;
  return collection.findOne({ id }, { projection: { _id: 0 } });
}

export async function listOrdersForBuyer(buyerUid, { limit = 50 } = {}) {
  const collection = await getOrdersCollection();
  if (!collection) {
    return [...memoryOrders.values()]
      .filter((order) => order.buyerUid === buyerUid)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }
  return collection.find({ buyerUid }, { projection: { _id: 0 } })
    .sort({ createdAt: -1, id: -1 }).limit(limit).toArray();
}

export async function listOrdersForSeller(sellerUid, { limit = 50 } = {}) {
  const collection = await getOrdersCollection();
  if (!collection) {
    return [...memoryOrders.values()]
      .filter((order) => order.items.some((item) => item.sellerUid === sellerUid))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }
  return collection.find({ 'items.sellerUid': sellerUid }, { projection: { _id: 0 } })
    .sort({ createdAt: -1, id: -1 }).limit(limit).toArray();
}

export async function updateOrder(id, expectedStatus, update, { requireNoPaymentAttempt = false } = {}) {
  const collection = await getOrdersCollection();
  if (!collection) {
    const current = memoryOrders.get(id);
    if (!current || current.status !== expectedStatus
      || (requireNoPaymentAttempt && current.paymentAttemptId)) return null;
    const saved = { ...current, ...update };
    memoryOrders.set(id, saved);
    return saved;
  }
  const result = await collection.findOneAndUpdate(
    {
      id,
      status: expectedStatus,
      ...(requireNoPaymentAttempt ? { paymentAttemptId: { $exists: false } } : {})
    },
    { $set: update },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  return result || null;
}

export async function claimPaymentAttempt(id, paymentId) {
  const collection = await getOrdersCollection();
  if (!collection) {
    const current = memoryOrders.get(id);
    if (!current || current.status !== 'pending_payment' || current.paymentAttemptId) return null;
    const saved = { ...current, paymentAttemptId: paymentId };
    memoryOrders.set(id, saved);
    return saved;
  }
  const result = await collection.findOneAndUpdate(
    { id, status: 'pending_payment', paymentAttemptId: { $exists: false } },
    { $set: { paymentAttemptId: paymentId } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  return result || null;
}

export async function clearPaymentAttempt(id, paymentId) {
  const collection = await getOrdersCollection();
  if (!collection) {
    const current = memoryOrders.get(id);
    if (!current || current.paymentAttemptId !== paymentId) return null;
    const { paymentAttemptId: _paymentAttemptId, ...saved } = current;
    memoryOrders.set(id, saved);
    return saved;
  }
  const result = await collection.findOneAndUpdate(
    { id, paymentAttemptId: paymentId },
    { $unset: { paymentAttemptId: '' } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  return result || null;
}

export async function listExpiredPendingOrders(now = new Date(), { limit = 100 } = {}) {
  const collection = await getOrdersCollection();
  if (!collection) {
    return [...memoryOrders.values()]
      .filter((order) => order.status === 'pending_payment' && new Date(order.reservationExpiresAt) <= now)
      .slice(0, limit);
  }
  return collection.find(
    { status: 'pending_payment', reservationExpiresAt: { $lte: now } },
    { projection: { _id: 0 } }
  ).sort({ reservationExpiresAt: 1 }).limit(limit).toArray();
}

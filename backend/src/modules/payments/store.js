import { getDb, isMongoConfigured } from '../../db.js';

const memoryPayments = new Map();

async function getPaymentsCollection() {
  if (!isMongoConfigured()) return null;
  const db = await getDb();
  return db.collection('payments');
}

export async function insertPayment(payment) {
  const collection = await getPaymentsCollection();
  if (!collection) {
    if ([...memoryPayments.values()].some((item) => item.merchantReference === payment.merchantReference)) {
      const error = new Error('Payment reference already exists.');
      error.code = 11000;
      throw error;
    }
    memoryPayments.set(payment.id, payment);
    return payment;
  }
  await collection.insertOne(payment);
  return payment;
}

export async function getPaymentById(id) {
  const collection = await getPaymentsCollection();
  if (!collection) return memoryPayments.get(id) || null;
  return collection.findOne({ id }, { projection: { _id: 0 } });
}

export async function getPaymentByMerchantReference(merchantReference) {
  const collection = await getPaymentsCollection();
  if (!collection) {
    return [...memoryPayments.values()].find((payment) => payment.merchantReference === merchantReference) || null;
  }
  return collection.findOne({ merchantReference }, { projection: { _id: 0 } });
}

export async function getPaymentByTrackingId(orderTrackingId) {
  const collection = await getPaymentsCollection();
  if (!collection) {
    return [...memoryPayments.values()].find((payment) => payment.orderTrackingId === orderTrackingId) || null;
  }
  return collection.findOne({ orderTrackingId }, { projection: { _id: 0 } });
}

export async function getLatestPaymentForOrder(orderId) {
  const collection = await getPaymentsCollection();
  if (!collection) {
    return [...memoryPayments.values()]
      .filter((payment) => payment.orderId === orderId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  }
  return collection.find({ orderId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 }).limit(1).next();
}

export async function listPaymentsForAdmin({ status, orderId, limit = 50 } = {}) {
  const collection = await getPaymentsCollection();
  if (!collection) {
    return [...memoryPayments.values()]
      .filter((payment) => (!status || payment.status === status)
        && (!orderId || payment.orderId === orderId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }
  const query = {};
  if (status) query.status = status;
  if (orderId) query.orderId = orderId;
  return collection.find(query, { projection: { _id: 0 } })
    .sort({ createdAt: -1, id: -1 }).limit(limit).toArray();
}

export async function updatePayment(id, update) {
  const collection = await getPaymentsCollection();
  if (!collection) {
    const current = memoryPayments.get(id);
    if (!current) return null;
    const saved = { ...current, ...update };
    memoryPayments.set(id, saved);
    return saved;
  }
  const result = await collection.findOneAndUpdate(
    { id },
    { $set: update },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  return result || null;
}

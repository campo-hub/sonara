import { getDb, isMongoConfigured } from '../../db.js';
import { HttpError } from '../../middleware/errors.js';
import { listPaymentsForAdmin } from '../payments/store.js';

const memoryAuditLog = [];

export async function appendAuditLog(entry) {
  if (!isMongoConfigured()) {
    memoryAuditLog.push(entry);
    return entry;
  }
  const db = await getDb();
  await db.collection('auditLog').insertOne(entry);
  return entry;
}

export async function listAdminOrders(filters = {}) {
  const { listAllOrdersForAdmin } = await import('../orders/store.js');
  return listAllOrdersForAdmin(filters);
}

export async function listAdminPayments(filters = {}) {
  return listPaymentsForAdmin(filters);
}

export async function resolveOrderDispute(id, resolution, actorUid) {
  const { getOrderById, updateOrder } = await import('../orders/store.js');
  const order = await getOrderById(id);
  if (!order || order.status !== 'disputed') return null;
  return updateOrder(id, 'disputed', {
    disputeResolution: resolution,
    disputeResolvedAt: new Date(),
    disputeResolvedBy: actorUid,
    updatedAt: new Date()
  });
}

export async function getAdminSummary() {
  if (!isMongoConfigured()) {
    throw new HttpError(503, 'Summary reports require the configured MongoDB database.', 'REPORTS_UNAVAILABLE');
  }
  const db = await getDb();
  const [userCount, listingByCategory, listingByCounty, orderStatuses, gmv, payoutTotals] = await Promise.all([
    db.collection('users').countDocuments({}),
    db.collection('products').aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray(),
    db.collection('products').aggregate([
      { $group: { _id: '$location.county', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray(),
    db.collection('orders').aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray(),
    db.collection('orders').aggregate([
      { $match: { status: { $in: ['paid', 'confirmed', 'dispatched', 'delivered', 'completed', 'disputed'] } } },
      { $group: { _id: null, totalKes: { $sum: '$total' }, count: { $sum: 1 } } }
    ]).toArray(),
    db.collection('payouts').aggregate([
      { $group: { _id: '$status', amountKes: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray()
  ]);
  return {
    generatedAt: new Date(),
    users: { total: userCount },
    listings: {
      byCategory: listingByCategory.map(({ _id, count }) => ({ category: _id || 'uncategorized', count })),
      byCounty: listingByCounty.map(({ _id, count }) => ({ county: _id || 'unspecified', count }))
    },
    orders: { byStatus: orderStatuses.map(({ _id, count }) => ({ status: _id, count })) },
    gmv: { amountKes: gmv[0]?.totalKes || 0, orderCount: gmv[0]?.count || 0 },
    payouts: payoutTotals.map(({ _id, amountKes, count }) => ({ status: _id || 'unknown', amountKes, count }))
  };
}

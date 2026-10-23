import { getDb, isMongoConfigured } from '../../db.js';
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

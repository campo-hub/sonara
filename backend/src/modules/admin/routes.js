import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { clearRoleCache, requireRole } from '../../middleware/roles.js';
import { getUserProfile, updateSellerAdminState } from '../../userStore.js';
import {
  appendAuditLog,
  listAdminOrders,
  listAdminPayments,
  resolveOrderDispute
} from './store.js';
import { getProductById, listProductsByStatus, setSellerProductsStatus, updateProduct } from '../products/store.js';
import { getOrderById } from '../orders/store.js';
import { getProductReport, listOpenProductReports, resolveProductReport } from '../reports/store.js';

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function boundedLimit(value) {
  const parsed = Number(value || 50);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 50;
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function parseListFilters(query) {
  const allowed = new Set(['status', 'buyerUid', 'sellerUid', 'orderId', 'limit']);
  if (Object.keys(query).some((key) => !allowed.has(key))) {
    throw new HttpError(400, 'Unsupported filter.', 'INVALID_FILTER');
  }
  return {
    status: typeof query.status === 'string' ? query.status : '',
    buyerUid: typeof query.buyerUid === 'string' ? query.buyerUid : '',
    sellerUid: typeof query.sellerUid === 'string' ? query.sellerUid : '',
    orderId: typeof query.orderId === 'string' ? query.orderId : '',
    limit: boundedLimit(query.limit)
  };
}

export function createAdminRouter({
  authMiddleware = requireAuth,
  requireAdminMiddleware = requireRole('admin'),
  audit = appendAuditLog,
  listProducts = listProductsByStatus,
  changeProduct = updateProduct,
  changeSellerProducts = setSellerProductsStatus,
  getSeller = getUserProfile,
  changeSeller = updateSellerAdminState,
  listOrders = listAdminOrders,
  listPayments = listAdminPayments,
  getOrder = getOrderById,
  getProduct = getProductById,
  resolveDispute = resolveOrderDispute,
  listReports = listOpenProductReports,
  getReport = getProductReport,
  resolveReport = resolveProductReport
} = {}) {
  const router = Router();
const protect = [authMiddleware, requireAdminMiddleware];

router.get('/admin/listings', ...protect, asyncRoute(async (req, res) => {
    const status = req.query.status || 'pending';
    if (!['pending', 'active', 'paused', 'removed'].includes(status)) {
      throw new HttpError(400, 'Listing status filter is invalid.', 'INVALID_FILTER');
    }
    const products = await listProducts(status, boundedLimit(req.query.limit));
    res.set('Cache-Control', 'private, no-store').json({ products });
  }));

  router.post('/admin/listings/:id/approve', ...protect, asyncRoute(async (req, res) => {
    const product = await changeProduct(req.params.id, { status: 'active', updatedAt: new Date() }, 'pending');
    if (!product) throw new HttpError(409, 'Only a pending listing can be approved.', 'LISTING_STATE_CHANGED');
    await audit({ at: new Date(), actorUid: req.user.uid, action: 'listing.approved', entity: 'product', entityId: product.id, meta: {} });
    res.set('Cache-Control', 'private, no-store').json({ product });
  }));

  router.post('/admin/listings/:id/reject', ...protect, asyncRoute(async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    const product = await changeProduct(req.params.id, {
      status: 'removed',
      rejectionReason: reason,
      updatedAt: new Date()
    }, 'pending');
    if (!product) throw new HttpError(409, 'Only a pending listing can be rejected.', 'LISTING_STATE_CHANGED');
    await audit({ at: new Date(), actorUid: req.user.uid, action: 'listing.rejected', entity: 'product', entityId: product.id, meta: { reason } });
    res.set('Cache-Control', 'private, no-store').json({ product });
  }));

  router.get('/admin/reports', ...protect, asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'private, no-store').json({ reports: await listReports(boundedLimit(req.query.limit)) });
  }));

  router.post('/admin/reports/:id/takedown', ...protect, asyncRoute(async (req, res) => {
    const report = await getReport(req.params.id);
    if (!report || report.status !== 'open') throw new HttpError(404, 'Open listing report not found.', 'REPORT_NOT_FOUND');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (!reason) throw new HttpError(400, 'A takedown reason is required.', 'INVALID_TAKEDOWN');
    const product = await changeProduct(report.productId, {
      status: 'removed',
      takedownReason: reason,
      updatedAt: new Date()
    }, 'active');
    const currentProduct = product || await getProduct(report.productId);
    if (!currentProduct) throw new HttpError(404, 'Listing not found.', 'PRODUCT_NOT_FOUND');
    if (!product && currentProduct.status !== 'removed') {
      throw new HttpError(409, 'The listing changed; refresh and try again.', 'LISTING_STATE_CHANGED');
    }
    const resolved = await resolveReport(report.id);
    if (!resolved) throw new HttpError(409, 'The report changed; refresh and try again.', 'REPORT_STATE_CHANGED');
    await audit({ at: new Date(), actorUid: req.user.uid, action: 'listing.taken_down', entity: 'product', entityId: report.productId, meta: { reportId: report.id, reason } });
    res.set('Cache-Control', 'private, no-store').json({ report: resolved, product: currentProduct });
  }));

  router.post('/admin/sellers/:uid/suspend', ...protect, asyncRoute(async (req, res) => {
    const seller = await getSeller(req.params.uid);
    if (!seller || !seller.roles?.includes('seller')) throw new HttpError(404, 'Seller not found.', 'SELLER_NOT_FOUND');
    const updated = await changeSeller(req.params.uid, { 'sellerProfile.suspended': true, updatedAt: new Date() });
    clearRoleCache();
    const hiddenCount = await changeSellerProducts(req.params.uid, 'active', 'paused');
    await audit({ at: new Date(), actorUid: req.user.uid, action: 'seller.suspended', entity: 'user', entityId: req.params.uid, meta: { hiddenListings: hiddenCount } });
    res.set('Cache-Control', 'private, no-store').json({ seller: updated, hiddenListings: hiddenCount });
  }));

  router.post('/admin/sellers/:uid/verify', ...protect, asyncRoute(async (req, res) => {
    const seller = await getSeller(req.params.uid);
    if (!seller || !seller.roles?.includes('seller')) throw new HttpError(404, 'Seller not found.', 'SELLER_NOT_FOUND');
    const updated = await changeSeller(req.params.uid, { 'sellerProfile.verified': true, updatedAt: new Date() });
    await audit({ at: new Date(), actorUid: req.user.uid, action: 'seller.verified', entity: 'user', entityId: req.params.uid, meta: {} });
    res.set('Cache-Control', 'private, no-store').json({ seller: updated });
  }));

  router.get('/admin/orders.csv', ...protect, asyncRoute(async (req, res) => {
    const orders = await listOrders(parseListFilters(req.query));
    const rows = [
      ['id', 'buyerUid', 'status', 'subtotal', 'deliveryFee', 'total', 'currency', 'createdAt'],
      ...orders.map((order) => [order.id, order.buyerUid, order.status, order.subtotal, order.deliveryFee, order.total, 'KES', order.createdAt])
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    await audit({ at: new Date(), actorUid: req.user.uid, action: 'orders.exported', entity: 'orders', entityId: '', meta: { count: orders.length } });
    res.set('Cache-Control', 'private, no-store')
      .type('text/csv')
      .attachment('agristore-orders.csv')
      .send(csv);
  }));

  router.get('/admin/orders', ...protect, asyncRoute(async (req, res) => {
    const orders = await listOrders(parseListFilters(req.query));
    res.set('Cache-Control', 'private, no-store').json({ orders });
  }));

  router.get('/admin/payments', ...protect, asyncRoute(async (req, res) => {
    const filters = parseListFilters(req.query);
    const payments = await listPayments({ status: filters.status, orderId: filters.orderId, limit: filters.limit });
    res.set('Cache-Control', 'private, no-store').json({ payments });
  }));

  router.post('/admin/orders/:id/resolve-dispute', ...protect, asyncRoute(async (req, res) => {
    const resolution = typeof req.body?.resolution === 'string' ? req.body.resolution.trim() : '';
    if (!resolution || resolution.length > 1000) {
      throw new HttpError(400, 'A dispute resolution of at most 1000 characters is required.', 'INVALID_RESOLUTION');
    }
    const order = await getOrder(req.params.id);
    if (!order || order.status !== 'disputed') throw new HttpError(404, 'Disputed order not found.', 'DISPUTE_NOT_FOUND');
    const updated = await resolveDispute(order.id, resolution, req.user.uid);
    if (!updated) throw new HttpError(409, 'The dispute changed; refresh and try again.', 'ORDER_STATE_CHANGED');
    await audit({ at: new Date(), actorUid: req.user.uid, action: 'dispute.resolved', entity: 'order', entityId: order.id, meta: { resolution } });
    res.set('Cache-Control', 'private, no-store').json({ order: updated });
  }));

  return router;
}

export default createAdminRouter();

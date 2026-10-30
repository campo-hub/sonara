import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { createUserRateLimiter } from '../../middleware/rateLimit.js';
import { PRODUCT_REPORT_REASONS, validateProductReport } from '../../models/marketplace.js';
import { getProductById } from '../products/store.js';
import { createProductReport } from './store.js';

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function createReportRouter({
  authMiddleware = requireAuth,
  rateLimiter = createUserRateLimiter(),
  getProduct = getProductById,
  createReport = createProductReport
} = {}) {
  const router = Router();
  router.post('/products/:id/reports', authMiddleware, rateLimiter, asyncRoute(async (req, res) => {
    const product = await getProduct(req.params.id);
    if (!product || product.status !== 'active' || product.sellerUid === req.user.uid) {
      throw new HttpError(404, 'Listing not found.', 'PRODUCT_NOT_FOUND');
    }
    const reason = req.body?.reason;
    const details = typeof req.body?.details === 'string' ? req.body.details.trim() : '';
    if (!PRODUCT_REPORT_REASONS.includes(reason) || details.length > 500) {
      throw new HttpError(400, 'Choose a report reason and provide no more than 500 characters of detail.', 'INVALID_REPORT');
    }
    const report = {
      id: randomUUID(),
      productId: product.id,
      reporterUid: req.user.uid,
      sellerUid: product.sellerUid,
      reason,
      details,
      status: 'open',
      createdAt: new Date()
    };
    const validationError = validateProductReport(report);
    if (validationError) throw new HttpError(400, validationError, 'INVALID_REPORT');
    try {
      await createReport(report);
    } catch (error) {
      if (error?.code === 11000) {
        throw new HttpError(409, 'You have already reported this listing.', 'REPORT_EXISTS');
      }
      throw error;
    }
    res.set('Cache-Control', 'private, no-store').status(201).json({ report: { id: report.id, status: report.status } });
  }));
  return router;
}

export default createReportRouter();

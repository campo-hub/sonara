import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { insertReview, findCompletedOrderForProduct, incrementProductRating } from './store.js';

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseReview(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['orderId', 'rating', 'comment'].includes(key))) {
    throw new HttpError(400, 'Review fields are invalid.', 'INVALID_REVIEW');
  }
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const rating = body.rating;
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (!orderId || !Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 500) {
    throw new HttpError(400, 'Provide an order, a rating from 1 to 5, and a comment of at most 500 characters.', 'INVALID_REVIEW');
  }
  return { orderId, rating, comment };
}

export function createReviewRouter({
  authMiddleware = requireAuth,
  completedOrderLookup = findCompletedOrderForProduct,
  createReview = insertReview,
  updateProductRating = incrementProductRating
} = {}) {
  const router = Router();
  router.post('/products/:id/reviews', authMiddleware, asyncRoute(async (req, res) => {
    const { orderId, rating, comment } = parseReview(req.body);
    const order = await completedOrderLookup(orderId, req.params.id, req.user.uid);
    if (!order) throw new HttpError(403, 'A review requires your completed order for this product.', 'REVIEW_NOT_ELIGIBLE');
    const item = order.items.find((entry) => entry.productId === req.params.id);
    const review = {
      id: randomUUID(),
      productId: req.params.id,
      orderId,
      buyerUid: req.user.uid,
      sellerUid: item.sellerUid,
      rating,
      comment,
      createdAt: new Date()
    };
    try {
      await createReview(review);
    } catch (error) {
      if (error?.code === 11000) {
        throw new HttpError(409, 'You have already reviewed this product for that order.', 'REVIEW_EXISTS');
      }
      throw error;
    }
    if (!await updateProductRating(req.params.id, rating)) {
      throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
    }
    res.set('Cache-Control', 'private, no-store').status(201).json({ review });
  }));
  return router;
}

export default createReviewRouter();

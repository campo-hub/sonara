import { getDb, isMongoConfigured } from '../../db.js';

const memoryReviews = new Map();

async function getReviewsCollection() {
  if (!isMongoConfigured()) return null;
  const db = await getDb();
  return db.collection('reviews');
}

export async function findCompletedOrderForProduct(orderId, productId, buyerUid) {
  if (!isMongoConfigured()) {
    const { getOrderById } = await import('../orders/store.js');
    const order = await getOrderById(orderId);
    return order?.buyerUid === buyerUid
      && order.status === 'completed'
      && order.items.some((item) => item.productId === productId)
      ? order
      : null;
  }
  const db = await getDb();
  return db.collection('orders').findOne({
    id: orderId,
    buyerUid,
    status: 'completed',
    'items.productId': productId
  }, { projection: { _id: 0 } });
}

export async function insertReview(review) {
  const collection = await getReviewsCollection();
  if (!collection) {
    const key = `${review.orderId}:${review.productId}`;
    if (memoryReviews.has(key)) {
      const error = new Error('A review already exists for this order and product.');
      error.code = 11000;
      throw error;
    }
    memoryReviews.set(key, review);
    return review;
  }
  await collection.insertOne(review);
  return review;
}

export async function incrementProductRating(productId, rating) {
  if (!isMongoConfigured()) {
    const { getProductById, updateProduct } = await import('../products/store.js');
    const product = await getProductById(productId);
    if (!product) return false;
    const count = product.ratingCount || 0;
    const average = ((product.ratingAvg || 0) * count + rating) / (count + 1);
    await updateProduct(productId, {
      ratingAvg: Math.round(average * 100) / 100,
      ratingCount: count + 1,
      updatedAt: new Date()
    });
    return true;
  }
  const db = await getDb();
  const result = await db.collection('products').updateOne(
    { id: productId },
    [{
      $set: {
        ratingCount: { $add: [{ $ifNull: ['$ratingCount', 0] }, 1] },
        ratingAvg: {
          $round: [{
            $divide: [
              {
                $add: [
                  { $multiply: [{ $ifNull: ['$ratingAvg', 0] }, { $ifNull: ['$ratingCount', 0] }] },
                  rating
                ]
              },
              { $add: [{ $ifNull: ['$ratingCount', 0] }, 1] }
            ]
          }, 2]
        },
        updatedAt: new Date()
      }
    }]
  );
  return result.matchedCount === 1;
}

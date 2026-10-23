export const USER_ROLES = Object.freeze(['buyer', 'seller', 'admin']);
export const PRODUCT_STATUSES = Object.freeze(['draft', 'pending', 'active', 'paused', 'sold_out', 'removed']);
export const PRODUCT_UNITS = Object.freeze(['kg', 'g', 'bag', 'crate', 'bunch', 'piece', 'litre', 'tray']);
export const ORDER_STATUSES = Object.freeze([
  'pending_payment',
  'paid',
  'confirmed',
  'dispatched',
  'delivered',
  'completed',
  'cancelled',
  'refunded',
  'disputed'
]);
export const PAYMENT_STATUSES = Object.freeze(['created', 'pending', 'completed', 'failed', 'reversed', 'invalid']);
export const PRODUCT_CATEGORIES = Object.freeze([
  'cereals',
  'vegetables',
  'fruits',
  'legumes',
  'tubers',
  'dairy',
  'eggs & poultry',
  'livestock',
  'herbs & spices',
  'seedlings',
  'inputs'
]);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmptyString = (value, maxLength) => typeof value === 'string'
  && value.trim().length > 0
  && value.trim().length <= maxLength;
const finiteNumber = (value, min = 0) => typeof value === 'number' && Number.isFinite(value) && value >= min;
const isUuid = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validDate = (value) => (value instanceof Date && !Number.isNaN(value.valueOf()))
  || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value)));
const moneyAmount = (value) => Number.isSafeInteger(value) && value >= 0;

export function validateUser(user) {
  if (!isRecord(user)) return 'User must be an object.';
  if (!nonEmptyString(user.uid, 128)) return 'User uid is required.';
  if (typeof user.email !== 'string' || user.email.length > 254) return 'User email must be a string of at most 254 characters.';
  if (!Array.isArray(user.roles) || user.roles.length === 0
    || user.roles.some((role) => !USER_ROLES.includes(role))
    || new Set(user.roles).size !== user.roles.length) {
    return 'User roles must contain unique supported role names.';
  }
  if (user.username != null && !nonEmptyString(user.username, 30)) return 'Username must contain 1-30 characters.';
  if (user.sellerProfile != null) {
    if (!isRecord(user.sellerProfile)
      || !nonEmptyString(user.sellerProfile.displayName, 100)
      || typeof user.sellerProfile.bio !== 'string'
      || user.sellerProfile.bio.length > 1000
      || !nonEmptyString(user.sellerProfile.county, 100)
      || !nonEmptyString(user.sellerProfile.town, 100)
      || typeof user.sellerProfile.verified !== 'boolean') {
      return 'Seller profile fields are invalid.';
    }
  }
  if (user.createdAt != null && !validDate(user.createdAt)) return 'User createdAt timestamp is invalid.';
  if (user.updatedAt != null && !validDate(user.updatedAt)) return 'User updatedAt timestamp is invalid.';
  return '';
}

export function validateProduct(product) {
  if (!isRecord(product)) return 'Product must be an object.';
  if (!isUuid(product.id) || !nonEmptyString(product.sellerUid, 128)) return 'Product id must be a UUID and sellerUid is required.';
  if (!PRODUCT_STATUSES.includes(product.status)) return 'Product status is invalid.';
  if (!nonEmptyString(product.title, 160) || !nonEmptyString(product.description, 5000)) return 'Product title or description is invalid.';
  if (!PRODUCT_CATEGORIES.includes(product.category)) return 'Product category is invalid.';
  if (!PRODUCT_UNITS.includes(product.unit)) return 'Product unit is invalid.';
  if (!moneyAmount(product.pricePerUnit) || product.pricePerUnit < 1) return 'pricePerUnit must be a positive whole-shilling KES amount.';
  if (!finiteNumber(product.minOrder, 0.000001)
    || !finiteNumber(product.quantityAvailable)
    || !finiteNumber(product.quantityReserved)
    || product.quantityReserved > product.quantityAvailable) {
    return 'Product order quantity or stock values are invalid.';
  }
  if (!Array.isArray(product.images) || product.images.length > 5) return 'Product images must be an array of at most 5 images.';
  if (product.images.some((image) => !isRecord(image)
    || !nonEmptyString(image.key, 1024)
    || !nonEmptyString(image.url, 2048)
    || !nonEmptyString(image.thumbKey, 1024)
    || !nonEmptyString(image.thumbUrl, 2048)
    || !Number.isInteger(image.width) || image.width < 1
    || !Number.isInteger(image.height) || image.height < 1)) {
    return 'Product image metadata is invalid.';
  }
  if (!isRecord(product.location)
    || !nonEmptyString(product.location.county, 100)
    || !nonEmptyString(product.location.town, 100)) {
    return 'Product location must include county and town.';
  }
  if (product.location.geo != null) {
    const geo = product.location.geo;
    if (!isRecord(geo) || geo.type !== 'Point'
      || !Array.isArray(geo.coordinates) || geo.coordinates.length !== 2
      || !finiteNumber(geo.coordinates[0], -180) || geo.coordinates[0] > 180
      || !finiteNumber(geo.coordinates[1], -90) || geo.coordinates[1] > 90) {
      return 'Product location coordinates must be a valid GeoJSON Point.';
    }
  }
  if (product.harvestDate != null && !validDate(product.harvestDate)) return 'Product harvestDate is invalid.';
  if (product.availableUntil != null && !validDate(product.availableUntil)) return 'Product availableUntil is invalid.';
  if (product.grade != null && (typeof product.grade !== 'string' || product.grade.length > 100)) return 'Product grade is invalid.';
  if (!finiteNumber(product.ratingAvg) || product.ratingAvg > 5
    || !Number.isInteger(product.ratingCount) || product.ratingCount < 0) {
    return 'Product rating fields are invalid.';
  }
  if (!validDate(product.createdAt) || !validDate(product.updatedAt)) return 'Product timestamps are invalid.';
  return '';
}

export function validateOrder(order) {
  if (!isRecord(order)) return 'Order must be an object.';
  if (!isUuid(order.id) || !nonEmptyString(order.buyerUid, 128)) return 'Order id must be a UUID and buyerUid is required.';
  if (!ORDER_STATUSES.includes(order.status)) return 'Order status is invalid.';
  if (!Array.isArray(order.items) || order.items.length === 0) return 'Order must contain at least one item.';
  for (const item of order.items) {
    if (!isRecord(item)
      || !nonEmptyString(item.productId, 128)
      || !nonEmptyString(item.sellerUid, 128)
      || !nonEmptyString(item.titleSnapshot, 160)
      || !PRODUCT_UNITS.includes(item.unit)
      || !finiteNumber(item.qty, 0.000001)
      || !moneyAmount(item.unitPrice)
      || !moneyAmount(item.lineTotal)) {
      return 'Order item fields or line total are invalid.';
    }
  }
  const subtotal = order.items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!moneyAmount(subtotal) || !moneyAmount(order.subtotal) || order.subtotal !== subtotal
    || !moneyAmount(order.deliveryFee)
    || !moneyAmount(order.total) || order.total !== order.subtotal + order.deliveryFee) {
    return 'Order money totals must be matching whole-shilling amounts.';
  }
  if (!isRecord(order.delivery)
    || !['pickup', 'seller_delivery'].includes(order.delivery.method)
    || !nonEmptyString(order.delivery.county, 100)
    || typeof order.delivery.phone !== 'string') {
    return 'Order delivery details are invalid.';
  }
  if (!nonEmptyString(order.merchantReference, 50) || !/^[A-Za-z0-9_-]+$/.test(order.merchantReference)) {
    return 'merchantReference must be URL-safe and at most 50 characters.';
  }
  if (!Array.isArray(order.statusHistory) || order.statusHistory.some((entry) => !isRecord(entry)
    || !ORDER_STATUSES.includes(entry.status) || !validDate(entry.at) || !nonEmptyString(entry.by, 128))) {
    return 'Order status history is invalid.';
  }
  if (!validDate(order.createdAt) || !validDate(order.updatedAt) || !validDate(order.reservationExpiresAt)) {
    return 'Order timestamps are invalid.';
  }
  return '';
}

export function validatePayment(payment) {
  if (!isRecord(payment)) return 'Payment must be an object.';
  if (!isUuid(payment.id) || !isUuid(payment.orderId)) return 'Payment and order ids must be UUIDs.';
  if (payment.provider !== 'pesapal') return 'Payment provider is invalid.';
  if (!PAYMENT_STATUSES.includes(payment.status)) return 'Payment status is invalid.';
  if (payment.orderTrackingId != null && !nonEmptyString(payment.orderTrackingId, 256)) return 'orderTrackingId is invalid.';
  if (!nonEmptyString(payment.merchantReference, 50) || !/^[A-Za-z0-9_-]+$/.test(payment.merchantReference)) {
    return 'Payment merchantReference is invalid.';
  }
  if (!moneyAmount(payment.amount) || payment.amount < 1 || payment.currency !== 'KES') {
    return 'Payment amount or currency is invalid.';
  }
  if (!validDate(payment.createdAt) || !validDate(payment.updatedAt)) return 'Payment timestamps are invalid.';
  if (payment.ipnReceivedAt != null
    && (!Array.isArray(payment.ipnReceivedAt) || payment.ipnReceivedAt.some((at) => !validDate(at)))) {
    return 'Payment IPN receipt timestamps are invalid.';
  }
  return '';
}

export function validateReview(review) {
  if (!isRecord(review)) return 'Review must be an object.';
  if (!isUuid(review.id)
    || !isUuid(review.productId)
    || !isUuid(review.orderId)
    || !nonEmptyString(review.buyerUid, 128)
    || !nonEmptyString(review.sellerUid, 128)) {
    return 'Review identifiers are required.';
  }
  if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) return 'Review rating must be an integer from 1 to 5.';
  if (typeof review.comment !== 'string' || review.comment.length > 500) return 'Review comment must be at most 500 characters.';
  if (!validDate(review.createdAt)) return 'Review createdAt timestamp is invalid.';
  return '';
}

export function validateAuditLog(entry) {
  if (!isRecord(entry)) return 'Audit log entry must be an object.';
  if (!validDate(entry.at)
    || !nonEmptyString(entry.actorUid, 128)
    || !nonEmptyString(entry.action, 100)
    || !nonEmptyString(entry.entity, 100)
    || !nonEmptyString(entry.entityId, 128)) {
    return 'Audit log fields are invalid.';
  }
  if (entry.meta != null && !isRecord(entry.meta)) return 'Audit log meta must be an object.';
  return '';
}

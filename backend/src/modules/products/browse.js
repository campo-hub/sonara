import { parseMoney } from '../../lib/money.js';
import { HttpError } from '../../middleware/errors.js';

export const BROWSE_SORTS = Object.freeze(['newest', 'price_asc', 'price_desc', 'nearest', 'top_rated']);
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 60;

const numericQuery = (value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value == null || value === '') return undefined;
  if (!/^-?\d+(?:\.\d+)?$/.test(String(value))) {
    throw new HttpError(400, `${name} must be numeric.`, 'INVALID_QUERY');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, `${name} must be between ${min} and ${max}.`, 'INVALID_QUERY');
  }
  return number;
};

function cursorPayload(cursor) {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!decoded || decoded.v !== 1 || typeof decoded.sort !== 'string'
      || typeof decoded.fingerprint !== 'string' || !decoded.after || typeof decoded.after !== 'object') {
      throw new Error('invalid shape');
    }
    return decoded;
  } catch {
    throw new HttpError(400, 'cursor is invalid.', 'INVALID_CURSOR');
  }
}

export function parseBrowseQuery(query = {}) {
  const limit = query.limit == null || query.limit === ''
    ? DEFAULT_PAGE_SIZE
    : numericQuery(query.limit, 'limit', { min: 1, max: MAX_PAGE_SIZE });
  if (!Number.isInteger(limit)) throw new HttpError(400, 'limit must be a whole number.', 'INVALID_QUERY');

  const q = String(query.q || '').trim();
  const category = String(query.category || '').trim().toLowerCase();
  const county = String(query.county || '').trim();
  if (q.length > 100) throw new HttpError(400, 'q must be at most 100 characters.', 'INVALID_QUERY');
  if (category.length > 100 || (category && !/^[a-z0-9][a-z0-9 &_-]*$/i.test(category))) {
    throw new HttpError(400, 'category is not supported.', 'INVALID_QUERY');
  }
  if (county.length > 100) throw new HttpError(400, 'county must be at most 100 characters.', 'INVALID_QUERY');

  let minPrice;
  let maxPrice;
  try {
    if (query.minPrice != null && query.minPrice !== '') minPrice = parseMoney(String(query.minPrice));
    if (query.maxPrice != null && query.maxPrice !== '') maxPrice = parseMoney(String(query.maxPrice));
  } catch {
    throw new HttpError(400, 'Price filters must be whole-shilling KES amounts.', 'INVALID_QUERY');
  }
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    throw new HttpError(400, 'minPrice cannot exceed maxPrice.', 'INVALID_QUERY');
  }

  const lat = numericQuery(query.lat, 'lat', { min: -90, max: 90 });
  const lng = numericQuery(query.lng, 'lng', { min: -180, max: 180 });
  if ((lat == null) !== (lng == null)) throw new HttpError(400, 'lat and lng must be provided together.', 'INVALID_QUERY');
  const sort = String(query.sort || 'newest');
  if (!BROWSE_SORTS.includes(sort)) throw new HttpError(400, 'sort is not supported.', 'INVALID_QUERY');
  if (sort === 'nearest' && lat == null) {
    throw new HttpError(400, 'lat and lng are required for nearest sorting.', 'INVALID_QUERY');
  }
  const radiusKm = numericQuery(query.radiusKm, 'radiusKm', { min: 0.1, max: 500 });
  if (radiusKm != null && lat == null) {
    throw new HttpError(400, 'lat and lng are required when using radiusKm.', 'INVALID_QUERY');
  }

  const filters = { q, category, county, minPrice, maxPrice, lat, lng, radiusKm };
  const fingerprint = Buffer.from(JSON.stringify({ ...filters, sort, limit })).toString('base64url');
  let after = null;
  if (query.cursor) {
    const decoded = cursorPayload(String(query.cursor));
    if (decoded.sort !== sort || decoded.fingerprint !== fingerprint) {
      throw new HttpError(400, 'cursor does not match these filters and sort options.', 'INVALID_CURSOR');
    }
    after = decoded.after;
    validateAfterCursor(after, sort);
  }
  return { filters, sort, limit, after, fingerprint };
}

function validateAfterCursor(after, sort) {
  if (typeof after.id !== 'string' || !after.id) {
    throw new HttpError(400, 'cursor is invalid.', 'INVALID_CURSOR');
  }
  const valid = sort === 'newest'
    ? typeof after.createdAt === 'string' && !Number.isNaN(Date.parse(after.createdAt))
    : sort === 'price_asc' || sort === 'price_desc'
      ? Number.isSafeInteger(after.price) && after.price >= 0
      : sort === 'top_rated'
        ? Number.isFinite(after.ratingAvg) && Number.isInteger(after.ratingCount)
          && typeof after.createdAt === 'string' && !Number.isNaN(Date.parse(after.createdAt))
        : Number.isFinite(after.distanceMeters) && after.distanceMeters >= 0;
  if (!valid) throw new HttpError(400, 'cursor is invalid.', 'INVALID_CURSOR');
}

export function encodeBrowseCursor(item, sort, fingerprint) {
  const after = sort === 'newest'
    ? { createdAt: new Date(item.createdAt).toISOString(), id: item.id }
    : sort === 'price_asc' || sort === 'price_desc'
      ? { price: item.pricePerUnit, id: item.id }
      : sort === 'top_rated'
        ? {
          ratingAvg: item.ratingAvg,
          ratingCount: item.ratingCount,
          createdAt: new Date(item.createdAt).toISOString(),
          id: item.id
        }
        : { distanceMeters: item.distanceMeters, id: item.id };
  return Buffer.from(JSON.stringify({ v: 1, sort, fingerprint, after })).toString('base64url');
}

export function toBrowseProduct(product) {
  const images = Array.isArray(product.images) ? product.images : [];
  const thumbs = images.map((image) => ({
    thumbUrl: image.thumbUrl,
    width: image.width,
    height: image.height
  }));
  const { distanceMeters, normalizedTitle, ...publicProduct } = product;
  return {
    ...publicProduct,
    ...(Number.isFinite(distanceMeters) ? { distanceKm: Math.round(distanceMeters / 10) / 100 } : {}),
    thumbUrl: thumbs[0]?.thumbUrl || '',
    images: thumbs
  };
}

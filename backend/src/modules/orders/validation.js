import { HttpError } from '../../middleware/errors.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseCheckoutRequest(body) {
  if (!isRecord(body)) throw new HttpError(400, 'Checkout body must be an object.', 'INVALID_CHECKOUT');
  const unexpected = Object.keys(body).find((key) => !['items', 'delivery'].includes(key));
  if (unexpected) throw new HttpError(400, `Field "${unexpected}" is not accepted at checkout.`, 'INVALID_CHECKOUT');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
    throw new HttpError(400, 'items must contain between 1 and 30 product quantities.', 'INVALID_CHECKOUT');
  }
  const items = body.items.map((item) => {
    if (!isRecord(item) || Object.keys(item).some((key) => !['productId', 'qty'].includes(key))) {
      throw new HttpError(400, 'Each item must contain only productId and qty.', 'INVALID_CHECKOUT');
    }
    if (typeof item.productId !== 'string' || !item.productId.trim() || item.productId.length > 128) {
      throw new HttpError(400, 'Each item requires a valid productId.', 'INVALID_CHECKOUT');
    }
    const qty = item.qty;
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) {
      throw new HttpError(400, 'Each item qty must be a positive finite number.', 'INVALID_CHECKOUT');
    }
    return { productId: item.productId, qty };
  });

  if (!isRecord(body.delivery)) throw new HttpError(400, 'delivery details are required.', 'INVALID_CHECKOUT');
  const delivery = body.delivery;
  if (Object.keys(delivery).some((key) => !['method', 'county', 'town', 'phone', 'notes'].includes(key))) {
    throw new HttpError(400, 'Delivery details contain an unsupported field.', 'INVALID_CHECKOUT');
  }
  if (!['pickup', 'seller_delivery'].includes(delivery.method)) {
    throw new HttpError(400, 'delivery.method must be pickup or seller_delivery.', 'INVALID_CHECKOUT');
  }
  const text = (value, field, maxLength, { required = false } = {}) => {
    if (typeof value !== 'string') {
      if (required) throw new HttpError(400, `${field} is required.`, 'INVALID_CHECKOUT');
      return '';
    }
    const normalized = value.trim();
    if ((required && !normalized) || normalized.length > maxLength) {
      throw new HttpError(400, `${field} is invalid.`, 'INVALID_CHECKOUT');
    }
    return normalized;
  };
  const normalizedDelivery = {
    method: delivery.method,
    county: text(delivery.county, 'delivery.county', 100, { required: true }),
    town: text(delivery.town, 'delivery.town', 100, { required: true }),
    phone: text(delivery.phone, 'delivery.phone', 32, { required: true }),
    notes: text(delivery.notes, 'delivery.notes', 500)
  };
  if (!/^\+?[0-9][0-9\s()-]{6,30}$/.test(normalizedDelivery.phone)) {
    throw new HttpError(400, 'delivery.phone must be a valid phone number.', 'INVALID_CHECKOUT');
  }
  return { items, delivery: normalizedDelivery };
}

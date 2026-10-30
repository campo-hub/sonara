import { parseMoney } from '../../lib/money.js';
import { roundCoordinates } from '../../lib/geo.js';
import { PRODUCT_UNITS } from '../../models/marketplace.js';
import { HttpError } from '../../middleware/errors.js';

const optionalText = (value, field, maxLength) => {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`, 'INVALID_PRODUCT');
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new HttpError(400, `${field} must be at most ${maxLength} characters.`, 'INVALID_PRODUCT');
  return normalized;
};

function parseQuantity(value, field, { required = false, positive = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${field} is required.`, 'INVALID_PRODUCT');
    return undefined;
  }
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    throw new HttpError(400, `${field} must be a ${positive ? 'positive' : 'non-negative'} decimal number.`, 'INVALID_PRODUCT');
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new HttpError(400, `${field} must be numeric.`, 'INVALID_PRODUCT');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (positive && parsed <= 0)) {
    throw new HttpError(400, `${field} must be a ${positive ? 'positive' : 'non-negative'} number.`, 'INVALID_PRODUCT');
  }
  return parsed;
}

function parseDate(value, field) {
  if (value == null || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new HttpError(400, `${field} must be a valid date.`, 'INVALID_PRODUCT');
  return date;
}

function parseCoordinates(body) {
  const hasLatitude = body.latitude != null && body.latitude !== '';
  const hasLongitude = body.longitude != null && body.longitude !== '';
  if (!hasLatitude && !hasLongitude) return undefined;
  if (!hasLatitude || !hasLongitude) {
    throw new HttpError(400, 'Both latitude and longitude are required when setting an approximate location.', 'INVALID_PRODUCT');
  }
  const geo = roundCoordinates(body.latitude, body.longitude);
  if (!geo) throw new HttpError(400, 'Location coordinates are invalid.', 'INVALID_PRODUCT');
  return geo;
}

export function parseProductFields(body, { partial = false } = {}) {
  const fields = {};
  const assignText = (field, maxLength, required = false) => {
    if (body[field] == null && partial) return;
    const value = optionalText(body[field] ?? '', field, maxLength);
    if (required && !value) throw new HttpError(400, `${field} is required.`, 'INVALID_PRODUCT');
    fields[field] = value;
  };

  assignText('title', 160, !partial);
  assignText('description', 5000, !partial);
  assignText('category', 100, !partial);
  assignText('unit', 20, !partial);
  if (fields.category && !/^[a-z0-9][a-z0-9 &_-]*$/i.test(fields.category)) {
    throw new HttpError(400, 'category is not supported.', 'INVALID_PRODUCT');
  }
  if (fields.unit && !PRODUCT_UNITS.includes(fields.unit)) {
    throw new HttpError(400, 'unit is not supported.', 'INVALID_PRODUCT');
  }

  if (body.pricePerUnit != null || !partial) {
    try {
      fields.pricePerUnit = parseMoney(String(body.pricePerUnit ?? ''));
      if (fields.pricePerUnit < 1) throw new TypeError();
    } catch {
      throw new HttpError(400, 'pricePerUnit must be a positive whole-shilling KES amount.', 'INVALID_PRODUCT');
    }
  }

  if (body.minOrder != null || !partial) {
    fields.minOrder = parseQuantity(body.minOrder, 'minOrder', { required: !partial, positive: true });
  }
  if (body.quantityAvailable != null || !partial) {
    fields.quantityAvailable = parseQuantity(body.quantityAvailable, 'quantityAvailable', { required: !partial });
  }

  assignText('grade', 100);
  if (body.harvestDate != null || !partial) fields.harvestDate = parseDate(body.harvestDate, 'harvestDate') || null;
  if (body.availableUntil != null || !partial) fields.availableUntil = parseDate(body.availableUntil, 'availableUntil') || null;

  const county = body.county;
  const town = body.town;
  if (county != null || town != null || !partial) {
    fields.location = {};
    if (county != null || !partial) fields.location.county = optionalText(county ?? '', 'county', 100);
    if (town != null || !partial) fields.location.town = optionalText(town ?? '', 'town', 100);
  }
  const geo = parseCoordinates(body);
  if (geo) fields.location = { ...fields.location, geo };
  if (body.latitude != null || body.longitude != null) {
    fields.location = { ...fields.location, ...(geo ? { geo } : {}) };
  }

  return fields;
}

export function parseImageKeyList(value, fieldName) {
  if (value == null || value === '') return [];
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new HttpError(400, `${fieldName} must be a JSON array of image keys.`, 'INVALID_PRODUCT');
    }
  }
  if (!Array.isArray(parsed) || parsed.some((key) => typeof key !== 'string' || !key.trim())) {
    throw new HttpError(400, `${fieldName} must be an array of image keys.`, 'INVALID_PRODUCT');
  }
  if (new Set(parsed).size !== parsed.length) throw new HttpError(400, `${fieldName} cannot contain duplicate image keys.`, 'INVALID_PRODUCT');
  return parsed;
}

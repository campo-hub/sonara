import { getDb, isMongoConfigured } from '../../db.js';

const memoryProducts = new Map();
const memorySellers = new Map();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildBrowseFilter(filters, { nearest = false } = {}) {
  const query = {
    status: 'active',
    $expr: {
      $gt: [
        { $subtract: ['$quantityAvailable', { $ifNull: ['$quantityReserved', 0] }] },
        0
      ]
    }
  };
  if (filters.category) query.category = filters.category;
  if (filters.county) query['location.county'] = new RegExp(`^${escapeRegex(filters.county)}$`, 'i');
  if (filters.minPrice != null || filters.maxPrice != null) {
    query.pricePerUnit = {};
    if (filters.minPrice != null) query.pricePerUnit.$gte = filters.minPrice;
    if (filters.maxPrice != null) query.pricePerUnit.$lte = filters.maxPrice;
  }
  if (filters.q) {
    if (nearest) {
      const pattern = new RegExp(escapeRegex(filters.q), 'i');
      query.$or = [{ title: pattern }, { description: pattern }];
    } else {
      query.$text = { $search: filters.q };
    }
  }
  return query;
}

function memoryDistanceKm(product, filters) {
  const coordinates = product.location?.geo?.coordinates;
  if (!Array.isArray(coordinates)) return Infinity;
  const [longitude, latitude] = coordinates;
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLatitude = radians(latitude - filters.lat);
  const deltaLongitude = radians(longitude - filters.lng);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(filters.lat)) * Math.cos(radians(latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compareProducts(left, right, sort) {
  if (sort === 'price_asc') return left.pricePerUnit - right.pricePerUnit || left.id.localeCompare(right.id);
  if (sort === 'price_desc') return right.pricePerUnit - left.pricePerUnit || left.id.localeCompare(right.id);
  if (sort === 'top_rated') {
    return right.ratingAvg - left.ratingAvg
      || right.ratingCount - left.ratingCount
      || new Date(right.createdAt) - new Date(left.createdAt)
      || right.id.localeCompare(left.id);
  }
  if (sort === 'nearest') return left.distanceMeters - right.distanceMeters || left.id.localeCompare(right.id);
  return new Date(right.createdAt) - new Date(left.createdAt) || right.id.localeCompare(left.id);
}

function afterCursorFilter(items, after, sort) {
  if (!after) return items;
  return items.filter((item) => {
    if (sort === 'newest') {
      const dateDiff = new Date(item.createdAt) - new Date(after.createdAt);
      return dateDiff < 0 || (dateDiff === 0 && item.id < after.id);
    }
    if (sort === 'price_asc') return item.pricePerUnit > after.price || (item.pricePerUnit === after.price && item.id > after.id);
    if (sort === 'price_desc') return item.pricePerUnit < after.price || (item.pricePerUnit === after.price && item.id > after.id);
    if (sort === 'top_rated') {
      if (item.ratingAvg !== after.ratingAvg) return item.ratingAvg < after.ratingAvg;
      if (item.ratingCount !== after.ratingCount) return item.ratingCount < after.ratingCount;
      const dateDiff = new Date(item.createdAt) - new Date(after.createdAt);
      return dateDiff < 0 || (dateDiff === 0 && item.id < after.id);
    }
    return item.distanceMeters > after.distanceMeters
      || (item.distanceMeters === after.distanceMeters && item.id > after.id);
  });
}

function memoryMatches(product, filters) {
  if (product.status !== 'active' || !(product.quantityAvailable - (product.quantityReserved || 0) > 0)) return false;
  if (filters.category && product.category !== filters.category) return false;
  if (filters.county && product.location?.county?.toLowerCase() !== filters.county.toLowerCase()) return false;
  if (filters.minPrice != null && product.pricePerUnit < filters.minPrice) return false;
  if (filters.maxPrice != null && product.pricePerUnit > filters.maxPrice) return false;
  if (filters.q) {
    const search = filters.q.toLowerCase();
    if (!`${product.title || ''} ${product.description || ''}`.toLowerCase().includes(search)) return false;
  }
  return true;
}

function projectBrowseItem(product, filters, sort) {
  if (sort !== 'nearest') return product;
  const distanceKm = memoryDistanceKm(product, filters);
  return { ...product, distanceMeters: distanceKm * 1000 };
}

export function browseProductsFromMemory(products, options) {
  const { filters, sort, after, limit } = options;
  let result = products.filter((product) => memoryMatches(product, filters))
    .map((product) => projectBrowseItem(product, filters, sort));
  if (sort === 'nearest' && filters.radiusKm != null) {
    result = result.filter((product) => product.distanceMeters <= filters.radiusKm * 1000);
  }
  result = afterCursorFilter(result, after, sort).sort((left, right) => compareProducts(left, right, sort));
  const page = result.slice(0, limit + 1);
  return { items: page.slice(0, limit), hasMore: page.length > limit };
}

function makeMongoSort(sort) {
  if (sort === 'price_asc') return { pricePerUnit: 1, id: 1 };
  if (sort === 'price_desc') return { pricePerUnit: -1, id: 1 };
  if (sort === 'top_rated') return { ratingAvg: -1, ratingCount: -1, createdAt: -1, id: -1 };
  return { createdAt: -1, id: -1 };
}

function mongoAfterFilter(after, sort) {
  if (!after) return null;
  if (sort === 'newest') {
    const createdAt = new Date(after.createdAt);
    return { $or: [{ createdAt: { $lt: createdAt } }, { createdAt, id: { $lt: after.id } }] };
  }
  if (sort === 'price_asc' || sort === 'price_desc') {
    const comparison = sort === 'price_asc' ? '$gt' : '$lt';
    return {
      $or: [
        { pricePerUnit: { [comparison]: after.price } },
        { pricePerUnit: after.price, id: { $gt: after.id } }
      ]
    };
  }
  if (sort === 'top_rated') {
    const createdAt = new Date(after.createdAt);
    return {
      $or: [
        { ratingAvg: { $lt: after.ratingAvg } },
        { ratingAvg: after.ratingAvg, ratingCount: { $lt: after.ratingCount } },
        { ratingAvg: after.ratingAvg, ratingCount: after.ratingCount, createdAt: { $lt: createdAt } },
        { ratingAvg: after.ratingAvg, ratingCount: after.ratingCount, createdAt, id: { $lt: after.id } }
      ]
    };
  }
  return {
    $or: [
      { distanceMeters: { $gt: after.distanceMeters } },
      { distanceMeters: after.distanceMeters, id: { $gt: after.id } }
    ]
  };
}

async function getProductsCollection() {
  if (!isMongoConfigured()) return null;
  const db = await getDb();
  return db.collection('products');
}

export async function insertProduct(product) {
  const collection = await getProductsCollection();
  if (!collection) {
    if (memoryProducts.has(product.id)) {
      const error = new Error('Product already exists.');
      error.code = 11000;
      throw error;
    }
    memoryProducts.set(product.id, product);
    return product;
  }
  await collection.insertOne(product);
  return product;
}

export async function getProductById(id) {
  const collection = await getProductsCollection();
  if (!collection) return memoryProducts.get(id) || null;
  return collection.findOne({ id }, { projection: { _id: 0 } });
}

export function normalizeProductName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function filterComparableProducts(products, product, { county = '', limit = 20 } = {}) {
  return products.filter((item) => item.id !== product.id
    && item.status === 'active'
    && item.quantityAvailable - (item.quantityReserved || 0) > 0
    && item.category === product.category
    && normalizeProductName(item.title) === normalizeProductName(product.title)
    && (!county || item.location?.county?.toLowerCase() === county.toLowerCase()))
    .sort((left, right) => left.pricePerUnit - right.pricePerUnit || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export async function findComparableProducts(product, { county = '', limit = 20 } = {}) {
  const collection = await getProductsCollection();
  const items = collection
    ? await collection.find({
      id: { $ne: product.id },
      category: product.category,
      status: 'active',
      $or: [
        { normalizedTitle: normalizeProductName(product.title) },
        { normalizedTitle: { $exists: false } }
      ],
      ...(county ? { 'location.county': new RegExp(`^${escapeRegex(county)}$`, 'i') } : {}),
      $expr: { $gt: [{ $subtract: ['$quantityAvailable', { $ifNull: ['$quantityReserved', 0] }] }, 0] }
    }, { projection: { _id: 0 } }).limit(1000).toArray()
    : [...memoryProducts.values()];
  return filterComparableProducts(items, product, { county, limit });
}

export async function countProductsForCategory(categoryId) {
  const collection = await getProductsCollection();
  if (!collection) return [...memoryProducts.values()].filter((item) => item.category === categoryId).length;
  return collection.countDocuments({ category: categoryId });
}

export async function listProductsForSeller(sellerUid) {
  const collection = await getProductsCollection();
  if (!collection) {
    return [...memoryProducts.values()].filter((product) => product.sellerUid === sellerUid);
  }
  return collection.find({ sellerUid }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
}

export async function listProductsByStatus(status, limit = 50) {
  const collection = await getProductsCollection();
  if (!collection) {
    return [...memoryProducts.values()]
      .filter((product) => product.status === status)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }
  return collection.find({ status }, { projection: { _id: 0 } })
    .sort({ createdAt: -1, id: -1 }).limit(limit).toArray();
}

export async function setSellerProductsStatus(sellerUid, fromStatus, toStatus) {
  const collection = await getProductsCollection();
  if (!collection) {
    let count = 0;
    for (const [id, product] of memoryProducts) {
      if (product.sellerUid !== sellerUid || product.status !== fromStatus) continue;
      memoryProducts.set(id, { ...product, status: toStatus, updatedAt: new Date() });
      count += 1;
    }
    return count;
  }
  const result = await collection.updateMany(
    { sellerUid, status: fromStatus },
    { $set: { status: toStatus, updatedAt: new Date() } }
  );
  return result.modifiedCount;
}

export async function browseProducts(options) {
  const collection = await getProductsCollection();
  if (!collection) return browseProductsFromMemory([...memoryProducts.values()], options);

  const { filters, sort, after, limit } = options;
  const match = buildBrowseFilter(filters);
  if (sort !== 'nearest') {
    const afterFilter = mongoAfterFilter(after, sort);
    if (afterFilter) match.$and = [afterFilter];
    const items = await collection.find(match, { projection: { _id: 0 } })
      .sort(makeMongoSort(sort))
      .limit(limit + 1)
      .toArray();
    return { items: items.slice(0, limit), hasMore: items.length > limit };
  }

  const radiusMeters = filters.radiusKm == null ? undefined : filters.radiusKm * 1000;
  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [filters.lng, filters.lat] },
        distanceField: 'distanceMeters',
        spherical: true,
        ...(radiusMeters == null ? {} : { maxDistance: radiusMeters }),
        query: match
      }
    }
  ];
  const afterFilter = mongoAfterFilter(after, sort);
  if (afterFilter) pipeline.push({ $match: afterFilter });
  pipeline.push({ $sort: { distanceMeters: 1, id: 1 } }, { $limit: limit + 1 }, { $project: { _id: 0 } });
  const items = await collection.aggregate(pipeline).toArray();
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}

export async function listActiveProductsForSeller(sellerUid, { limit = 60 } = {}) {
  const collection = await getProductsCollection();
  if (!collection) {
    return browseProductsFromMemory([...memoryProducts.values()].filter((product) => product.sellerUid === sellerUid), {
      filters: { q: '', category: '', county: '', minPrice: undefined, maxPrice: undefined },
      sort: 'newest',
      after: null,
      limit
    }).items;
  }
  return collection.find({
    sellerUid,
    status: 'active',
    $expr: { $gt: [{ $subtract: ['$quantityAvailable', { $ifNull: ['$quantityReserved', 0] }] }, 0] }
  }, { projection: { _id: 0 } }).sort({ createdAt: -1, id: -1 }).limit(limit).toArray();
}

export async function updateProduct(id, update, expectedStatus) {
  const collection = await getProductsCollection();
  if (!collection) {
    const current = memoryProducts.get(id);
    if (!current || (expectedStatus && current.status !== expectedStatus)) return null;
    const saved = { ...current, ...update };
    memoryProducts.set(id, saved);
    return saved;
  }
  const filter = { id, ...(expectedStatus ? { status: expectedStatus } : {}) };
  const result = await collection.findOneAndUpdate(
    filter,
    { $set: update },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  return result || null;
}

export async function reserveProductQuantity(id, quantity, expectedProduct = null) {
  const collection = await getProductsCollection();
  if (!collection) {
    const product = memoryProducts.get(id);
    if (!product || product.status !== 'active'
      || product.quantityAvailable - (product.quantityReserved || 0) < quantity
      || (expectedProduct && (
        product.sellerUid !== expectedProduct.sellerUid
        || product.title !== expectedProduct.title
        || product.unit !== expectedProduct.unit
        || product.pricePerUnit !== expectedProduct.pricePerUnit
        || product.minOrder !== expectedProduct.minOrder
      ))) return null;
    const saved = { ...product, quantityReserved: (product.quantityReserved || 0) + quantity };
    memoryProducts.set(id, saved);
    return saved;
  }
  const result = await collection.findOneAndUpdate(
    {
      id,
      status: 'active',
      ...(expectedProduct ? {
        sellerUid: expectedProduct.sellerUid,
        title: expectedProduct.title,
        unit: expectedProduct.unit,
        pricePerUnit: expectedProduct.pricePerUnit,
        minOrder: expectedProduct.minOrder
      } : {}),
      $expr: {
        $gte: [
          { $subtract: ['$quantityAvailable', { $ifNull: ['$quantityReserved', 0] }] },
          quantity
        ]
      }
    },
    { $inc: { quantityReserved: quantity }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  return result || null;
}

export async function releaseProductQuantity(id, quantity) {
  const collection = await getProductsCollection();
  if (!collection) {
    const product = memoryProducts.get(id);
    if (!product || (product.quantityReserved || 0) < quantity) {
      throw new Error(`Cannot release ${quantity} reserved units for product ${id}.`);
    }
    const saved = { ...product, quantityReserved: product.quantityReserved - quantity };
    memoryProducts.set(id, saved);
    return saved;
  }
  const result = await collection.findOneAndUpdate(
    { id, quantityReserved: { $gte: quantity } },
    { $inc: { quantityReserved: -quantity }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  if (!result) throw new Error(`Cannot release ${quantity} reserved units for product ${id}.`);
  return result;
}

export async function consumeProductReservation(id, quantity) {
  const collection = await getProductsCollection();
  if (!collection) {
    const product = memoryProducts.get(id);
    if (!product || (product.quantityReserved || 0) < quantity || product.quantityAvailable < quantity) {
      throw new Error(`Cannot consume ${quantity} reserved units for product ${id}.`);
    }
    const saved = {
      ...product,
      quantityAvailable: product.quantityAvailable - quantity,
      quantityReserved: product.quantityReserved - quantity,
      updatedAt: new Date()
    };
    memoryProducts.set(id, saved);
    return saved;
  }
  const result = await collection.findOneAndUpdate(
    { id, quantityReserved: { $gte: quantity }, quantityAvailable: { $gte: quantity } },
    {
      $inc: { quantityAvailable: -quantity, quantityReserved: -quantity },
      $set: { updatedAt: new Date() }
    },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  if (!result) throw new Error(`Cannot consume ${quantity} reserved units for product ${id}.`);
  return result;
}

export async function productHasOrders(productId) {
  const collection = await getProductsCollection();
  if (!collection) return false;
  const db = await getDb();
  return Boolean(await db.collection('orders').findOne(
    { 'items.productId': productId },
    { projection: { _id: 1 } }
  ));
}

export async function deleteProductRecord(id) {
  const collection = await getProductsCollection();
  if (!collection) {
    const product = memoryProducts.get(id) || null;
    memoryProducts.delete(id);
    return product;
  }
  const result = await collection.findOneAndDelete({ id }, { projection: { _id: 0 } });
  return result || null;
}

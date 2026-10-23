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

export async function listProductsForSeller(sellerUid) {
  const collection = await getProductsCollection();
  if (!collection) {
    return [...memoryProducts.values()].filter((product) => product.sellerUid === sellerUid);
  }
  return collection.find({ sellerUid }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
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

import { getDb, isMongoConfigured } from '../../db.js';

const memoryProducts = new Map();

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

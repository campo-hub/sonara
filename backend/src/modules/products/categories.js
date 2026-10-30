import { getDb, isMongoConfigured } from '../../db.js';
import { HttpError } from '../../middleware/errors.js';
import { countProductsForCategory } from './store.js';

export const DEFAULT_CATEGORIES = Object.freeze([
  'cereals',
  'vegetables',
  'fruits',
  'legumes',
  'tubers',
  'dairy',
  'eggs & poultry',
  'livestock',
  'livestock products',
  'herbs & spices',
  'seedlings',
  'inputs'
]);

const defaults = DEFAULT_CATEGORIES.map((name) => ({ id: name, name }));
const memoryCategories = new Map(defaults.map((category) => [category.id, category]));
const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

function categoryName(value) {
  const name = normalize(value);
  if (!name || name.length > 100 || !/^[a-z0-9][a-z0-9 &_-]*$/i.test(name)) {
    throw new HttpError(400, 'Category name must be 1-100 letters, numbers, spaces, ampersands, hyphens, or underscores.', 'INVALID_CATEGORY');
  }
  return name;
}

async function seedMongoDefaults(collection) {
  if (await collection.countDocuments({}) !== 0) return;
  await collection.bulkWrite(defaults.map((category) => ({
    updateOne: {
      filter: { id: category.id },
      update: { $setOnInsert: { ...category, createdAt: new Date(), updatedAt: new Date() } },
      upsert: true
    }
  })));
}

export async function listCategories() {
  if (!isMongoConfigured()) {
    return [...memoryCategories.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const db = await getDb();
  const collection = db.collection('categories');
  const categories = await collection.find({}, { projection: { _id: 0, id: 1, name: 1 } }).sort({ name: 1 }).toArray();
  return categories.length ? categories : defaults;
}

export async function createCategory(value) {
  const name = categoryName(value);
  const category = { id: name, name, createdAt: new Date(), updatedAt: new Date() };
  if (!isMongoConfigured()) {
    if ([...memoryCategories.values()].some((item) => item.name === name)) {
      throw new HttpError(409, 'That category already exists.', 'CATEGORY_EXISTS');
    }
    memoryCategories.set(category.id, category);
    return category;
  }
  const db = await getDb();
  const collection = db.collection('categories');
  await seedMongoDefaults(collection);
  if (await collection.findOne({ name })) throw new HttpError(409, 'That category already exists.', 'CATEGORY_EXISTS');
  try {
    await collection.insertOne(category);
    return category;
  } catch (error) {
    if (error?.code === 11000) throw new HttpError(409, 'That category already exists.', 'CATEGORY_EXISTS');
    throw error;
  }
}

export async function renameCategory(id, value) {
  const name = categoryName(value);
  if (!isMongoConfigured()) {
    const category = memoryCategories.get(id);
    if (!category) return null;
    if ([...memoryCategories.values()].some((item) => item.id !== id && item.name === name)) {
      throw new HttpError(409, 'That category already exists.', 'CATEGORY_EXISTS');
    }
    const updated = { ...category, name, updatedAt: new Date() };
    memoryCategories.set(id, updated);
    return updated;
  }
  const db = await getDb();
  const collection = db.collection('categories');
  await seedMongoDefaults(collection);
  if (await collection.findOne({ id: { $ne: id }, name })) {
    throw new HttpError(409, 'That category already exists.', 'CATEGORY_EXISTS');
  }
  return collection.findOneAndUpdate(
    { id },
    { $set: { name, updatedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
}

export async function removeCategory(id) {
  const products = await countProductsForCategory(id);
  if (products) throw new HttpError(409, 'This category is used by listings and cannot be removed.', 'CATEGORY_IN_USE');
  if (!isMongoConfigured()) return memoryCategories.delete(id);
  const db = await getDb();
  const collection = db.collection('categories');
  await seedMongoDefaults(collection);
  return Boolean(await collection.findOneAndDelete({ id }));
}

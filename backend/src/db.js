import { MongoClient } from 'mongodb';
import { config } from './config.js';

let clientPromise;

export function isMongoConfigured() {
  return Boolean(config.mongoUri);
}

export async function getDb() {
  if (!isMongoConfigured()) return null;

  if (!clientPromise) {
    const client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }

  const client = await clientPromise;
  return client.db(config.mongoDbName);
}

export async function ensureIndexes(db) {
  if (!db) throw new Error('A connected database is required to create indexes.');

  await Promise.all([
    db.collection('users').createIndex({ uid: 1 }, { unique: true }),
    db.collection('users').createIndex({ usernameLower: 1 }, { unique: true, sparse: true }),
    db.collection('products').createIndex({ id: 1 }, { unique: true }),
    db.collection('products').createIndex({ sellerUid: 1, status: 1 }),
    db.collection('products').createIndex({ status: 1, category: 1, createdAt: -1 }),
    db.collection('products').createIndex({ 'location.county': 1, status: 1 }),
    db.collection('products').createIndex({ 'location.geo': '2dsphere' }),
    db.collection('products').createIndex({ title: 'text', description: 'text' }),
    db.collection('orders').createIndex({ id: 1 }, { unique: true }),
    db.collection('orders').createIndex({ merchantReference: 1 }, { unique: true }),
    db.collection('orders').createIndex({ buyerUid: 1, createdAt: -1 }),
    db.collection('orders').createIndex({ 'items.sellerUid': 1, createdAt: -1 }),
    db.collection('orders').createIndex({ status: 1, reservationExpiresAt: 1 }),
    db.collection('payments').createIndex({ orderTrackingId: 1 }, { unique: true, sparse: true }),
    db.collection('reviews').createIndex({ orderId: 1, productId: 1 }, { unique: true })
  ]);
}

export async function closeDb() {
  if (!clientPromise) return;
  const client = await clientPromise;
  await client.close();
  clientPromise = undefined;
}

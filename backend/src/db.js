import { MongoClient } from 'mongodb';
import { config } from './config.js';

let clientPromise;

export const INDEX_DEFINITIONS = Object.freeze([
  { collection: 'users', key: { uid: 1 }, options: { unique: true } },
  { collection: 'users', key: { usernameLower: 1 }, options: { unique: true, sparse: true } },
  { collection: 'products', key: { id: 1 }, options: { unique: true } },
  { collection: 'products', key: { sellerUid: 1, status: 1 } },
  { collection: 'products', key: { status: 1, category: 1, createdAt: -1 } },
  { collection: 'products', key: { category: 1, normalizedTitle: 1, status: 1 } },
  { collection: 'products', key: { 'location.county': 1, status: 1 } },
  { collection: 'products', key: { 'location.geo': '2dsphere' } },
  { collection: 'products', key: { title: 'text', description: 'text' } },
  { collection: 'messages', key: { id: 1 }, options: { unique: true } },
  { collection: 'messages', key: { conversationId: 1, createdAt: -1, id: -1 } },
  { collection: 'conversations', key: { id: 1 }, options: { unique: true } },
  { collection: 'conversations', key: { participantKey: 1 }, options: { unique: true } },
  { collection: 'conversations', key: { participants: 1, lastMessageAt: -1 } },
  { collection: 'messageReports', key: { id: 1 }, options: { unique: true } },
  { collection: 'messageReports', key: { status: 1, createdAt: -1 } },
  { collection: 'notifications', key: { id: 1 }, options: { unique: true } },
  { collection: 'notifications', key: { uid: 1, readAt: 1, createdAt: -1 } },
  { collection: 'notifications', key: { uid: 1, eventKey: 1 }, options: { unique: true, sparse: true } },
  { collection: 'categories', key: { id: 1 }, options: { unique: true } },
  { collection: 'categories', key: { name: 1 }, options: { unique: true } },
  { collection: 'orders', key: { id: 1 }, options: { unique: true } },
  { collection: 'orders', key: { merchantReference: 1 }, options: { unique: true } },
  { collection: 'orders', key: { buyerUid: 1, createdAt: -1 } },
  { collection: 'orders', key: { 'items.sellerUid': 1, createdAt: -1 } },
  { collection: 'orders', key: { status: 1, reservationExpiresAt: 1 } },
  { collection: 'payments', key: { id: 1 }, options: { unique: true } },
  { collection: 'payments', key: { merchantReference: 1 }, options: { unique: true } },
  { collection: 'payments', key: { orderTrackingId: 1 }, options: { unique: true, sparse: true } },
  { collection: 'payments', key: { orderId: 1, createdAt: -1 } },
  { collection: 'reviews', key: { orderId: 1, productId: 1 }, options: { unique: true } },
  { collection: 'reports', key: { productId: 1, reporterUid: 1 }, options: { unique: true } },
  { collection: 'reports', key: { status: 1, createdAt: -1 } },
  { collection: 'auditLog', key: { at: -1 } },
  { collection: 'auditLog', key: { actorUid: 1, at: -1 } }
]);

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

  await Promise.all(INDEX_DEFINITIONS.map(({ collection, key, options }) => (
    db.collection(collection).createIndex(key, options)
  )));
}

export async function closeDb() {
  if (!clientPromise) return;
  const client = await clientPromise;
  await client.close();
  clientPromise = undefined;
}

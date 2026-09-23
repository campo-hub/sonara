/**
 * Fixes the "catalog resets on every Render restart" bug: track metadata
 * (title/artist/album/duration/cover/audio URL) is written once, at
 * upload time, into a durable store. Reading the catalog is then a plain
 * read from that store — never a live rescan-and-reparse of every audio
 * file in the bucket on every request, which was the main cause of slow /
 * timed-out /api/catalog calls.
 *
 * When MongoDB isn't configured (e.g. local dev without a Mongo URI), this
 * transparently falls back to an in-memory Map so the app still works,
 * with the explicit tradeoff that data will not survive a restart. That
 * tradeoff is now a conscious fallback instead of the only option.
 */

import { MongoClient } from 'mongodb';

let mongoClient = null;
let collection = null;
const memoryStore = new Map();

export function isMongoConfigured() {
  return Boolean(process.env.MONGODB_URI);
}

export async function getTrackCollection() {
  if (!isMongoConfigured()) return null;
  if (collection) return collection;
  mongoClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await mongoClient.connect();
  const dbName = process.env.MONGODB_DB_NAME || 'sonara';
  const db = mongoClient.db(dbName);
  collection = db.collection('tracks');
  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ createdAt: -1 });
  return collection;
}

export async function upsertTrack(track) {
  const col = await getTrackCollection();
  if (col) {
    await col.updateOne({ id: track.id }, { $set: track }, { upsert: true });
    return track;
  }
  memoryStore.set(track.id, track);
  return track;
}

export async function listTracks() {
  const col = await getTrackCollection();
  if (col) {
    const docs = await col.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
    return docs;
  }
  return [...memoryStore.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function deleteTrack(id) {
  const col = await getTrackCollection();
  if (col) {
    await col.deleteOne({ id });
    return;
  }
  memoryStore.delete(id);
}

export async function trackExists(id) {
  const col = await getTrackCollection();
  if (col) return Boolean(await col.findOne({ id }, { projection: { _id: 1 } }));
  return memoryStore.has(id);
}

export function storageMode() {
  return isMongoConfigured() ? 'mongodb' : 'memory';
}

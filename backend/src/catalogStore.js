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
import { normalizeGenre } from './genres.js';

let mongoClient = null;
let collection = null;
const memoryStore = new Map();
const memoryBatches = new Map();
let memoryClaimQueue = Promise.resolve();

const initialGenreState = (track) => {
  const taggedGenre = normalizeGenre(track.genre);
  return {
    genreStatus: track.genreStatus || (taggedGenre && track.genreSource === 'tag' ? 'classified' : 'pending'),
    exportBatchId: track.exportBatchId ?? null,
    exportedAt: track.exportedAt ?? null
  };
};

export function isMongoConfigured() {
  return Boolean(process.env.MONGODB_URI);
}

export async function getDb() {
  if (!isMongoConfigured()) return null;
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await mongoClient.connect();
  }
  const dbName = process.env.MONGODB_DB_NAME || 'sonara';
  return mongoClient.db(dbName);
}

export async function getTrackCollection() {
  if (!isMongoConfigured()) return null;
  if (collection) return collection;
  const db = await getDb();
  collection = db.collection('tracks');
  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ createdAt: -1 });
  await collection.createIndex({ genre: 1 });
  await collection.createIndex({ genreStatus: 1, createdAt: 1 });
  await collection.createIndex({ exportBatchId: 1 });
  return collection;
}

export async function bulkUpdateTrackGenres(rows = []) {
  const col = await getTrackCollection();
  if (col) {
    const results = [];
    for (const row of rows) {
      const update = { $set: { ...row } };
      results.push(col.updateOne({ id: row.id }, update, { upsert: false }));
    }
    await Promise.all(results);
    return rows.length;
  }

  for (const row of rows) {
    const current = memoryStore.get(row.id);
    if (!current) continue;
    memoryStore.set(row.id, { ...current, ...row });
  }
  return rows.length;
}

export async function upsertTrack(track) {
  const col = await getTrackCollection();
  const { genreStatus, exportBatchId, exportedAt, ...metadata } = track;
  const state = initialGenreState({ ...track, genreStatus, exportBatchId, exportedAt });
  if (col) {
    await col.updateOne(
      { id: track.id },
      { $set: metadata, $setOnInsert: state },
      { upsert: true }
    );
    return track;
  }
  const existing = memoryStore.get(track.id);
  memoryStore.set(track.id, existing ? { ...existing, ...metadata } : { ...metadata, ...state });
  return track;
}

export async function migrateGenreStatuses() {
  const col = await getTrackCollection();
  if (col) {
    const result = await col.updateMany(
      { genreStatus: { $exists: false } },
      [{ $set: { genreStatus: { $cond: [{ $ne: [{ $ifNull: ['$genre', ''] }, ''] }, 'classified', 'pending'] }, exportBatchId: null, exportedAt: null } }]
    );
    return result.modifiedCount || 0;
  }

  let migrated = 0;
  for (const [id, track] of memoryStore) {
    if (track.genreStatus) continue;
    memoryStore.set(id, { ...track, ...initialGenreState(track) });
    migrated += 1;
  }
  return migrated;
}

export async function claimPendingTracks(batchId, batchSize, exportedAt) {
  const size = Math.max(1, Math.min(500, Number(batchSize) || 200));
  const col = await getTrackCollection();
  if (col) {
    const candidates = await col.find({ genreStatus: 'pending' }, { projection: { id: 1 } })
      .sort({ createdAt: 1, id: 1 }).limit(size).toArray();
    const ids = candidates.map((track) => track.id);
    if (!ids.length) return [];
    await col.updateMany(
      { id: { $in: ids }, genreStatus: 'pending' },
      { $set: { genreStatus: 'exported', exportBatchId: batchId, exportedAt } }
    );
    return col.find({ exportBatchId: batchId, genreStatus: 'exported' }, { projection: { _id: 0 } })
      .sort({ createdAt: 1, id: 1 }).toArray();
  }

  let result;
  memoryClaimQueue = memoryClaimQueue.then(async () => {
    const candidates = [...memoryStore.values()]
      .filter((track) => track.genreStatus === 'pending')
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt) || String(left.id).localeCompare(String(right.id)))
      .slice(0, size);
    result = candidates.map((track) => ({ ...track, genreStatus: 'exported', exportBatchId: batchId, exportedAt }));
    for (const track of result) memoryStore.set(track.id, track);
  });
  await memoryClaimQueue;
  return result || [];
}

export async function getTrackById(id) {
  const col = await getTrackCollection();
  if (col) return col.findOne({ id }, { projection: { _id: 0 } });
  return memoryStore.get(id) || null;
}

export async function updateTracksByIds(ids, update) {
  const col = await getTrackCollection();
  if (col) {
    const result = await col.updateMany({ id: { $in: ids } }, { $set: update });
    return result.modifiedCount || 0;
  }
  let count = 0;
  for (const id of ids) {
    const track = memoryStore.get(id);
    if (!track) continue;
    memoryStore.set(id, { ...track, ...update });
    count += 1;
  }
  return count;
}

export async function updateTrackIf(id, filter, update) {
  const col = await getTrackCollection();
  if (col) {
    const result = await col.updateOne({ id, ...filter }, { $set: update });
    return result.modifiedCount > 0;
  }
  const current = memoryStore.get(id);
  if (!current || Object.entries(filter).some(([key, value]) => current[key] !== value)) return false;
  memoryStore.set(id, { ...current, ...update });
  return true;
}

export async function saveExportBatch(batch) {
  const col = await getTrackCollection();
  if (col) {
    const db = await getDb();
    await db.collection('exportBatches').createIndex({ batchId: 1 }, { unique: true });
    await db.collection('exportBatches').insertOne(batch);
    return batch;
  }
  memoryBatches.set(batch.batchId, batch);
  return batch;
}

export async function getExportBatch(batchId) {
  const col = await getTrackCollection();
  if (col) return (await getDb()).collection('exportBatches').findOne({ batchId }, { projection: { _id: 0 } });
  return memoryBatches.get(batchId) || null;
}

export async function listExportBatches() {
  const col = await getTrackCollection();
  if (col) return (await getDb()).collection('exportBatches').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray();
  return [...memoryBatches.values()].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

export async function updateExportBatch(batchId, update) {
  const col = await getTrackCollection();
  if (col) {
    await (await getDb()).collection('exportBatches').updateOne({ batchId }, { $set: update });
    return getExportBatch(batchId);
  }
  const current = memoryBatches.get(batchId);
  if (!current) return null;
  const next = { ...current, ...update };
  memoryBatches.set(batchId, next);
  return next;
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

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import compression from 'compression';
import cron from 'node-cron';
import * as mm from 'music-metadata';
import { randomUUID } from 'node:crypto';

import {
  isAudioFile,
  isImageFile,
  detectAudioMimeType,
  buildObjectKey,
  deriveTrackId,
  mergeTrackMetadata,
  parseTrackMetadataFromName,
  buildFallbackCatalog,
  hasLateMoovBox
} from './uploadUtils.js';
import { isStorageConfigured, listObjects, putObject, publicUrlFor } from './storage.js';
import {
  upsertTrack,
  listTracks,
  storageMode,
  isMongoConfigured,
  getDb,
  trackExists,
  migrateGenreStatuses,
  claimPendingTracks,
  getTrackById,
  updateTrackIf,
  saveExportBatch,
  getExportBatch,
  listExportBatches,
  updateExportBatch
} from './catalogStore.js';
import { buildEmptyLibraryPayload, mergeLibraryData, normalizeLibraryData } from './libraryUtils.js';
import { verifyIdToken, isFirebaseConfigured } from './firebaseAdmin.js';
import { getAdminConfig, claimAdmin, isAdminUser } from './adminStore.js';
import {
  addTrackToPlaylist,
  createPlaylistForUser,
  deletePlaylistForUser,
  listUserPlaylists,
  migrateLegacyPlaylistsForUser,
  normalizePlaylistName,
  removeTrackFromPlaylist,
  renamePlaylistForUser
} from './playlistStore.js';
import { getUserProfile, saveUserProfile, validateUsername } from './userStore.js';
import { generateDailyMixSnapshot, getPlayableTracks } from './recommendationUtils.js';
import { getAllowedGenres, normalizeGenre } from './genres.js';
import { buildGenreAwareDailyMix, exportCatalogCsv } from './genreMixUtils.js';

const app = express();
app.use(compression());
app.use(express.json({ limit: '2mb' }));

const memoryDailyMixes = new Map();
const memoryMixHistory = new Map();
const memorySavedMixes = new Map();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getLocalDateKey = (timeZone, now = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
};

const getRecommendationRequest = (req) => {
  const timeZone = String(req.query.tz || 'UTC');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    return { error: 'Invalid timezone.' };
  }
  const deviceId = String(req.query.deviceId || '').trim();
  if (deviceId && !UUID_PATTERN.test(deviceId)) return { error: 'Invalid device id.' };
  const dateKey = getLocalDateKey(timeZone);
  const ownerKey = req.user?.uid ? `u:${req.user.uid}` : `d:${deviceId || 'anonymous'}`;
  return { timeZone, deviceId, dateKey, ownerKey };
};

const recommendationCollections = async () => {
  if (!isMongoConfigured()) return null;
  const db = await getDb();
  const dailyMixes = db.collection('dailyMixes');
  const mixHistory = db.collection('mixHistory');
  const savedMixes = db.collection('savedMixes');
  const mixOwners = db.collection('mixOwners');
  await Promise.all([
    dailyMixes.createIndex({ ownerKey: 1, dateKey: 1 }, { unique: true }),
    dailyMixes.createIndex({ createdAt: 1 }, { expireAfterSeconds: 8 * 24 * 60 * 60 }),
    mixHistory.createIndex({ ownerKey: 1 }, { unique: true }),
    mixHistory.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }),
    savedMixes.createIndex({ ownerUid: 1, updatedAt: -1 }),
    savedMixes.createIndex({ ownerUid: 1, 'origin.mixId': 1 }, { unique: true }),
    mixOwners.createIndex({ ownerKey: 1 }, { unique: true }),
    mixOwners.createIndex({ lastSeenAt: 1 })
  ]);
  return { dailyMixes, mixHistory, savedMixes, mixOwners };
};

const getDailySnapshot = async (ownerKey, dateKey) => {
  const collections = await recommendationCollections();
  if (!collections) return memoryDailyMixes.get(`${ownerKey}:${dateKey}`) || null;
  return collections.dailyMixes.findOne({ ownerKey, dateKey }, { projection: { _id: 0 } });
};

const createDailySnapshot = async ({ ownerKey, dateKey, catalog, deviceId, uid }) => {
  const collections = await recommendationCollections();
  const key = `${ownerKey}:${dateKey}`;
  if (!collections) {
    const existing = memoryDailyMixes.get(key);
    if (existing) return existing;
    const history = memoryMixHistory.get(ownerKey) || { seen: [], names: [] };
    const generated = generateDailyMixSnapshot({ catalog, dateKey, seen: history.seen, recentNames: history.names });
    const snapshot = { ownerKey, dateKey, mixes: generated.mixes, createdAt: new Date().toISOString(), deviceId, ownerUid: uid || null };
    memoryMixHistory.set(ownerKey, { seen: generated.seen, names: generated.names, updatedAt: new Date().toISOString() });
    memoryDailyMixes.set(key, snapshot);
    return snapshot;
  }

  const history = await collections.mixHistory.findOne({ ownerKey }) || { seen: [], names: [] };
  const generated = generateDailyMixSnapshot({ catalog, dateKey, seen: history.seen, recentNames: history.names });
  const snapshot = { ownerKey, dateKey, mixes: generated.mixes, createdAt: new Date(), deviceId, ownerUid: uid || null };
  try {
    await collections.dailyMixes.insertOne(snapshot);
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  await collections.mixHistory.updateOne(
    { ownerKey },
    { $set: { ownerKey, cycle: history.cycle || 0, seen: generated.seen, names: generated.names, updatedAt: new Date() } },
    { upsert: true }
  );
  return (await getDailySnapshot(ownerKey, dateKey)) || snapshot;
};

const enrichDailyMixes = async (snapshot, uid) => {
  const catalog = (await getCatalogSnapshot()).tracks;
  const byId = new Map(getPlayableTracks(catalog).map((track) => [track.id, track]));
  const saved = uid ? await listSavedMixes(uid) : [];
  return (snapshot?.mixes || []).map((mix) => {
    const savedMix = saved.find((item) => item.origin?.mixId === mix.id);
    return {
      ...mix,
      label: 'Recommended',
      trackIds: mix.trackIds.filter((id) => byId.has(String(id))),
      saved: Boolean(savedMix),
      savedId: savedMix?.id || null
    };
  });
};

const listSavedMixes = async (ownerUid) => {
  const collections = await recommendationCollections();
  if (!collections) return [...memorySavedMixes.values()].filter((mix) => mix.ownerUid === ownerUid);
  return collections.savedMixes.find({ ownerUid }, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).toArray();
};

const findSavedMix = async (ownerUid, id) => {
  const collections = await recommendationCollections();
  if (!collections) return memorySavedMixes.get(id)?.ownerUid === ownerUid ? memorySavedMixes.get(id) : null;
  return collections.savedMixes.findOne({ ownerUid, id }, { projection: { _id: 0 } });
};

const touchMixOwner = async ({ ownerKey, timeZone }) => {
  if (!ownerKey) return;
  const collections = await recommendationCollections();
  const payload = { ownerKey, tz: timeZone || 'UTC', lastSeenAt: new Date() };
  if (!collections) return;
  await collections.mixOwners.updateOne({ ownerKey }, { $set: payload }, { upsert: true });
};

export const precomputeDailyMixes = async ({ now = new Date(), budgetMs = 20000 } = {}) => {
  const collections = await recommendationCollections();
  if (!collections) return { owners: 0, generated: 0 };
  const owners = await collections.mixOwners.find({ lastSeenAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }).limit(500).toArray();
  const catalog = (await getCatalogSnapshot()).tracks;
  const startedAt = Date.now();
  let generated = 0;
  for (const owner of owners) {
    if (Date.now() - startedAt >= budgetMs) break;
    const dateKey = getLocalDateKey(owner.tz || 'UTC', new Date(now.getTime() + 2 * 60 * 60 * 1000));
    if (await getDailySnapshot(owner.ownerKey, dateKey)) continue;
    await createDailySnapshot({ ownerKey: owner.ownerKey, dateKey, catalog, deviceId: owner.ownerKey.startsWith('d:') ? owner.ownerKey.slice(2) : '', uid: owner.ownerKey.startsWith('u:') ? owner.ownerKey.slice(2) : null });
    generated += 1;
  }
  return { owners: owners.length, generated };
};

/* -------------------------------------------------------------------------- */
/*  CORS                                                                      */
/* -------------------------------------------------------------------------- */
/*
 * Previous version computed an `allowedOrigins` allowlist from CORS_ORIGIN
 * but never actually used it - the cors() call below reflected every
 * origin regardless. That's not a bug that was breaking anything (it was
 * accidentally permissive, not accidentally restrictive), but it was
 * misleading dead code implying protection that wasn't happening. This
 * version is explicit: if CORS_ORIGIN is set, only those origins are
 * allowed; if it's unset, everything is allowed (useful for early local
 * development) and that fact is logged loudly on boot so it's never a
 * silent surprise in production.
 */
const configuredOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const defaultAllowedOrigins = new Set([
  'https://campo-hub.github.io',
  'https://www.campo-hub.github.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173'
]);

const allowedOrigins = new Set([...configuredOrigins, ...defaultAllowedOrigins]);

if (!configuredOrigins.length) {
  console.warn('[cors] CORS_ORIGIN is not set - using the app defaults for local and GitHub Pages access.');
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // curl/health checks/no Origin header
    if (!configuredOrigins.length || allowedOrigins.has(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} is not allowed.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* -------------------------------------------------------------------------- */
/*  Auth (optional - app works read-only without Firebase configured)         */
/* -------------------------------------------------------------------------- */

async function optionalAuth(req, _res, next) {
  req.user = null;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token && isFirebaseConfigured()) {
    try {
      req.user = await verifyIdToken(token);
    } catch {
      req.user = null; // invalid/expired token -> treat as anonymous, don't 500
    }
  }
  next();
}

async function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Sign in to continue.' });
  }
  return next();
}

async function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Sign in to continue.' });
  }
  if (!(await isAdminUser(req.user))) {
    return res.status(403).json({ message: 'Access denied: Admin privileges required.' });
  }
  return next();
}

app.use(optionalAuth);

/* -------------------------------------------------------------------------- */
/*  Basic routes                                                              */
/* -------------------------------------------------------------------------- */

app.get('/', (_req, res) => {
  res.type('text/plain').send('Sonara backend API is running. See /api/health.');
});

app.get('/api', (_req, res) => {
  res.json({ ok: true, routes: ['/api/health', '/api/catalog', '/api/uploads/bulk', '/api/me/library'] });
});

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    storage: isStorageConfigured() ? 'r2' : 'not-configured',
    catalogStore: storageMode(),
    auth: isFirebaseConfigured() ? 'firebase' : 'disabled',
    bucketSync: lastSync,
    time: new Date().toISOString()
  });
});

/* -------------------------------------------------------------------------- */
/*  Catalog                                                                   */
/* -------------------------------------------------------------------------- */
/*
 * This is now a plain read from the persistent track store. No R2
 * rescanning, no re-downloading every audio file, no per-request
 * metadata re-parsing. That work happens exactly once, at upload time,
 * in POST /api/uploads/bulk below.
 */
const WRITE_CONCURRENCY = 10;

function hashMixSeed(value = '') {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getMixDateKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function buildDailyMixForCatalog({ catalog = [], userId = 'guest', dateKey = getMixDateKey(), limit = 5 } = {}) {
  return buildGenreAwareDailyMix({ catalog, userId, dateKey, limit });
}

/**
 * Makes sure every audio file that exists in the R2 bucket also exists in the
 * catalog store.
 *
 * What was wrong before: the sync only ran when the catalog was completely
 * empty, only looked under "uploads/", stopped at 200 files, and used a
 * different id scheme than uploads. So music already sitting in the bucket
 * (outside uploads/, or in a bucket that already had 1 track in the DB) never
 * showed up in the frontend.
 *
 * This version: scans the whole bucket, skips anything already known (by
 * object key or id), and only adds what is missing. It is safe to run
 * repeatedly.
 *
 * Dependencies are passed in so this can be unit tested without R2/Mongo.
 */
async function syncBucketIntoCatalog({ listObjects, publicUrlFor, upsertTrack, listTracks, prefix = '' }) {
  const objects = await listObjects(prefix);
  const audio = objects.filter((obj) => obj?.Key && !String(obj.Key).endsWith('/') && isAudioFile(obj.Key));

  const existing = await listTracks();
  const knownKeys = new Set(existing.map((track) => track.objectKey).filter(Boolean));
  const knownIds = new Set(existing.map((track) => track.id));

  const fresh = [];
  for (const obj of audio) {
    const key = String(obj.Key).replace(/^\/+/, '');
    const id = deriveTrackId(key);
    if (knownKeys.has(key) || knownIds.has(id)) continue;

    const audioUrl = publicUrlFor(key);
    if (!audioUrl) {
      // Better to fail loudly than store tracks that can never play.
      throw new Error('R2_PUBLIC_BASE_URL is not set on the server, so audio URLs cannot be built.');
    }

    const parts = key.split('/');
    const fileName = parts.pop() || 'track';
    const folder = parts.filter((part) => part !== 'uploads').join('/');
    const meta = parseTrackMetadataFromName(fileName, folder);

    fresh.push({
      id,
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      duration: 0, // the player fills this in from the audio itself once played
      cover: '',
      audioUrl,
      objectKey: key,
      source: 'bucket',
      createdAt: obj.LastModified ? new Date(obj.LastModified).toISOString() : new Date().toISOString()
    });
  }

  for (let i = 0; i < fresh.length; i += WRITE_CONCURRENCY) {
    await Promise.all(fresh.slice(i, i + WRITE_CONCURRENCY).map((track) => upsertTrack(track)));
  }

  return {
    objectsInBucket: objects.length,
    audioFound: audio.length,
    alreadyInCatalog: audio.length - fresh.length,
    added: fresh.length
  };
}

/*
 * Bucket sync state. The catalog is served from the database, but music that
 * exists in the R2 bucket and is missing from the database gets added here.
 * Throttled so a busy site doesn't list the bucket on every request.
 */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const SYNC_RETRY_MS = 60 * 1000;
let lastSyncAttemptAt = 0;
let lastSync = { ran: false };
let catalogCache = { tracks: null, etag: '', loadedAt: 0, promise: null };

const catalogProjection = {
  _id: 0,
  id: 1,
  title: 1,
  artist: 1,
  album: 1,
  duration: 1,
  cover: 1,
  audioUrl: 1,
  objectKey: 1,
  source: 1,
  createdAt: 1,
  addedAt: 1,
  uploadedBy: 1,
  uploadedByName: 1,
  uploadedByEmail: 1,
  genre: 1,
  subgenres: 1,
  mood: 1,
  energy: 1,
  language: 1,
  genreSource: 1,
  genreConfidence: 1,
  genreUpdatedAt: 1
};

const invalidateCatalogCache = () => {
  catalogCache = { tracks: null, etag: '', loadedAt: 0, promise: null };
};

const getCatalogSnapshot = async () => {
  if (catalogCache.tracks && Date.now() - catalogCache.loadedAt < 30000) return catalogCache;
  if (!catalogCache.promise) {
    catalogCache.promise = (async () => {
      const db = await getDb();
      const tracks = db
        ? await db.collection('tracks').find({}, { projection: catalogProjection }).sort({ createdAt: -1 }).toArray()
        : await listTracks();
      const body = JSON.stringify({ songs: tracks });
      catalogCache = { tracks, etag: `"${Buffer.from(body).toString('base64url')}"`, loadedAt: Date.now(), promise: null };
      return catalogCache;
    })().catch((error) => {
      catalogCache.promise = null;
      throw error;
    });
  }
  return catalogCache.promise;
};

async function maybeSyncBucket() {
  if (!isStorageConfigured()) return;
  if (Date.now() - lastSyncAttemptAt < SYNC_INTERVAL_MS) return;
  lastSyncAttemptAt = Date.now();
  try {
    const result = await syncBucketIntoCatalog({ listObjects, publicUrlFor, upsertTrack, listTracks });
    invalidateCatalogCache();
    lastSync = { ran: true, ok: true, at: new Date().toISOString(), ...result };
    console.log('[catalog] bucket sync', result);
  } catch (error) {
    // Retry soon, and never let a sync problem take down the catalog itself.
    lastSyncAttemptAt = Date.now() - SYNC_INTERVAL_MS + SYNC_RETRY_MS;
    lastSync = { ran: true, ok: false, at: new Date().toISOString(), error: error.message };
    console.error('[catalog] bucket sync failed (serving stored tracks):', error.message);
  }
}

app.get('/api/catalog', async (req, res) => {
  try {
    const snapshot = await getCatalogSnapshot();
    if (req.headers['if-none-match'] === snapshot.etag) return res.status(304).end();
    res.set({ ETag: snapshot.etag, 'Cache-Control': 'public, max-age=30, stale-while-revalidate=300' });
    void maybeSyncBucket();
    return res.json({ songs: snapshot.tracks });
  } catch (error) {
    console.error('[catalog] failed', error);
    return res.status(500).json({ message: 'Unable to load the catalog right now.' });
  }
});

app.get('/api/admin/genres/vocabulary', requireAdmin, async (_req, res) => {
  const genres = getAllowedGenres();
  return res.json({ genres, count: genres.length, normalizeGenre });
});

app.get('/api/genres', async (_req, res) => {
  try {
    const tracks = await listTracks();
    const summary = new Map();
    for (const track of tracks) {
      const genre = normalizeGenre(track.genre) || 'Unsorted';
      summary.set(genre, (summary.get(genre) || 0) + 1);
    }
    const payload = [...summary.entries()].map(([genre, count]) => ({ genre, trackCount: count })).sort((left, right) => right.trackCount - left.trackCount || left.genre.localeCompare(right.genre));
    return res.json(payload);
  } catch (error) {
    console.error('[genres] summary failed', error);
    return res.status(500).json({ message: 'Unable to load genre summary.' });
  }
});

app.get('/api/recommendations/genre/:genre', async (req, res) => {
  try {
    const genre = normalizeGenre(req.params.genre) || 'Unsorted';
    const tracks = await listTracks();
    const items = tracks.filter((track) => (normalizeGenre(track.genre) || 'Unsorted') === genre).slice(0, 100);
    return res.json({ genre, tracks: items });
  } catch (error) {
    console.error('[genres] browsing failed', error);
    return res.status(500).json({ message: 'Unable to load genre recommendation.' });
  }
});

const catalogImportHistory = [];
const LOW_CONFIDENCE_THRESHOLD = 0.6;

const makeExportBatchId = () => {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').slice(0, 15);
  return `b-${stamp}-${randomUUID().slice(0, 4)}`;
};

const getBatchCounts = async (batchId) => {
  const tracks = (await listTracks()).filter((track) => track.exportBatchId === batchId);
  return {
    exported: tracks.length,
    imported: tracks.filter((track) => ['classified', 'needs_review'].includes(track.genreStatus)).length,
    outstanding: tracks.filter((track) => track.genreStatus === 'exported').length
  };

};

const updateBatchStatus = async (batchId) => {
  const counts = await getBatchCounts(batchId);
  const current = await getExportBatch(batchId);
  if (!current) return null;
  const status = counts.outstanding === 0 ? 'complete' : counts.imported ? 'partial' : 'open';
  return updateExportBatch(batchId, { ...counts, status });
};

const parseBatchImport = async (rawCsv, { overwrite = false } = {}) => {
  const rows = parseCsvRows(rawCsv);
  const batchIds = [...new Set(rows.map((row) => String(row.batchId || '').trim()).filter(Boolean))];
  const batchId = batchIds.length === 1 ? batchIds[0] : '';
  const batch = batchId ? await getExportBatch(batchId) : null;
  const accepted = [];
  const rejected = { notExported: [], alreadyClassified: [], wrongBatch: [], unknownId: [], invalidGenre: [] };

  for (const [index, row] of rows.entries()) {
    const id = String(row.id || '').trim();
    const track = id ? await getTrackById(id) : null;
    const rowNumber = index + 2;
    if (!track) {
      rejected.unknownId.push({ row: rowNumber, id });
      continue;
    }
    if (track.genreStatus === 'classified' || track.genreStatus === 'needs_review') {
      if (!overwrite) rejected.alreadyClassified.push({ row: rowNumber, id });
    }
    if (!batch || !batchIds.includes(String(row.batchId || '').trim()) || track.exportBatchId !== batchId) {
      rejected.wrongBatch.push({ row: rowNumber, id });
      continue;
    }
    if (track.genreStatus === 'pending') {
      rejected.notExported.push({ row: rowNumber, id });
      continue;
    }
    if (track.genreStatus !== 'exported' && !overwrite) continue;

    const genre = normalizeGenre(row.genre);
    if (!genre) {
      rejected.invalidGenre.push({ row: rowNumber, id, genre: row.genre || '' });
      continue;
    }
    accepted.push({
      row: rowNumber,
      id,
      batchId,
      patch: {
        genre,
        subgenres: typeof row.subgenres === 'string' ? row.subgenres.split('|').map((item) => item.trim()).filter(Boolean) : [],
        mood: row.mood || '',
        energy: row.energy || '',
        language: row.language || '',
        genreSource: row.genreSource || 'csv-import',
        genreConfidence: Number(row.genreConfidence) || 0,
        genreUpdatedAt: row.genreUpdatedAt || new Date().toISOString(),
        genreStatus: Number(row.genreConfidence) >= LOW_CONFIDENCE_THRESHOLD ? 'classified' : 'needs_review'
      }
    });
  }

  return {
    ok: Boolean(batch && batchId),
    batchId,
    batchKnown: Boolean(batch),
    accepted,
    rejected,
    totalRows: rows.length,
    errors: batchId && batch ? [] : [{ message: 'The CSV must contain one known batchId column value.' }]
  };
};

const applyBatchImport = async (preview) => {
  const batch = await getExportBatch(preview.batchId);
  if (!batch) return { ok: false, message: 'Export batch not found.' };
  const changed = [];
  for (const item of preview.accepted || []) {
    const current = await getTrackById(item.id);
    if (!current) continue;
    const changedTrack = await updateTrackIf(
      item.id,
      { genreStatus: current.genreStatus === 'exported' ? 'exported' : current.genreStatus, exportBatchId: preview.batchId },
      item.patch
    );
    if (changedTrack) changed.push(item.id);
  }
  const updatedBatch = await updateBatchStatus(preview.batchId);
  return { ok: true, batchId: preview.batchId, changed, rejected: preview.rejected, batch: updatedBatch };
};

app.post('/api/admin/catalog/exports', requireAdmin, async (req, res) => {
  try {
    await migrateGenreStatuses();
    const batchId = makeExportBatchId();
    const exportedAt = new Date().toISOString();
    const before = new Map((await listTracks()).map((track) => [track.id, track]));
    const tracks = await claimPendingTracks(batchId, req.body?.batchSize, exportedAt);
    if (!tracks.length) return res.status(204).json({ message: 'No new songs to export' });

    const batch = {
      batchId,
      createdAt: exportedAt,
      adminUid: req.user.uid,
      trackIds: tracks.map((track) => track.id),
      count: tracks.length,
      importedCount: 0,
      status: 'open',
      rows: tracks,
      previous: tracks.map((track) => ({ id: track.id, state: before.get(track.id) }))
    };
    await saveExportBatch(batch);
    const csv = exportCatalogCsv(tracks, { batchId });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sonara-${batchId}.csv"`);
    return res.send(csv);
  } catch (error) {
    console.error('[catalog export batch] failed', error);
    return res.status(500).json({ message: 'Unable to export the next catalog batch.' });
  }
});

app.get('/api/admin/catalog/exports/:batchId.csv', requireAdmin, async (req, res) => {
  const batch = await getExportBatch(req.params.batchId);
  if (!batch) return res.status(404).json({ message: 'Export batch not found.' });
  const csv = exportCatalogCsv(batch.rows || [], { batchId: batch.batchId });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sonara-${batch.batchId}.csv"`);
  return res.send(csv);
});

app.get('/api/admin/catalog/pending-count', requireAdmin, async (_req, res) => {
  await migrateGenreStatuses();
  const counts = { pending: 0, exported: 0, classified: 0, needsReview: 0 };
  for (const track of await listTracks()) {
    if (track.genreStatus === 'pending') counts.pending += 1;
    if (track.genreStatus === 'exported') counts.exported += 1;
    if (track.genreStatus === 'classified') counts.classified += 1;
    if (track.genreStatus === 'needs_review') counts.needsReview += 1;
  }
  return res.json(counts);
});

app.get('/api/admin/catalog/exports', requireAdmin, async (_req, res) => {
  const batches = await listExportBatches();
  const result = [];
  for (const batch of batches) {
    const current = await updateBatchStatus(batch.batchId);
    const ageDays = Math.floor((Date.now() - new Date(batch.createdAt).getTime()) / 86400000);
    result.push({ ...current, ageDays, stale: ageDays > 7 });
  }
  return res.json({ batches: result });
});

const releaseBatchTracks = async (batchId) => {
  const batch = await getExportBatch(batchId);
  if (!batch) return null;
  let released = 0;
  for (const id of batch.trackIds) {
    if (await updateTrackIf(id, { genreStatus: 'exported', exportBatchId: batchId }, { genreStatus: 'pending', exportBatchId: null, exportedAt: null })) released += 1;
  }
  await updateExportBatch(batchId, { status: 'released', releasedCount: released });
  return { batchId, released };
};

app.post('/api/admin/catalog/exports/:batchId/release', requireAdmin, async (req, res) => {
  const result = await releaseBatchTracks(req.params.batchId);
  if (!result) return res.status(404).json({ message: 'Export batch not found.' });
  return res.json(result);
});

app.post('/api/admin/catalog/exports/:batchId/requeue-outstanding', requireAdmin, async (req, res) => {
  const result = await releaseBatchTracks(req.params.batchId);
  if (!result) return res.status(404).json({ message: 'Export batch not found.' });
  return res.json(result);
});

app.post('/api/admin/catalog/exports/:batchId/rollback', requireAdmin, async (req, res) => {
  const batch = await getExportBatch(req.params.batchId);
  if (!batch) return res.status(404).json({ message: 'Export batch not found.' });
  let restored = 0;
  for (const item of batch.previous || []) {
    if (!item.state) continue;
    const current = await getTrackById(item.id);
    if (!current) continue;
    const { _id, ...state } = item.state;
    await updateTrackIf(item.id, {}, state);
    restored += 1;
  }
  await updateExportBatch(batch.batchId, { status: 'released', rolledBack: true });
  return res.json({ ok: true, batchId: batch.batchId, restored });
});

app.post('/api/admin/catalog/import/batch/preview', requireAdmin, async (req, res) => {
  try {
    const csvText = String(req.body?.csv ?? req.body?.content ?? '').trim();
    if (!csvText) return res.status(400).json({ message: 'CSV content is required.' });
    return res.json(await parseBatchImport(csvText, { overwrite: Boolean(req.body?.overwrite) }));
  } catch (error) {
    console.error('[catalog batch import preview] failed', error);
    return res.status(500).json({ message: 'Unable to preview this catalog batch.' });
  }
});

app.post('/api/admin/catalog/import/batch/apply', requireAdmin, async (req, res) => {
  try {
    const preview = req.body?.preview || await parseBatchImport(String(req.body?.csv ?? req.body?.content ?? ''), { overwrite: Boolean(req.body?.overwrite) });
    if (!preview.ok) return res.status(400).json(preview);
    return res.json(await applyBatchImport(preview));
  } catch (error) {
    console.error('[catalog batch import apply] failed', error);
    return res.status(500).json({ message: 'Unable to apply this catalog batch.' });
  }
});

const parseCsvRows = (rawValue) => {
  const text = String(rawValue ?? '');
  if (!text.trim()) return [];

  const rows = [];
  let current = '';
  let record = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      record.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      if (current.length || record.length) {
        record.push(current);
        rows.push(record);
        record = [];
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length || record.length) {
    record.push(current);
    rows.push(record);
  }

  if (!rows.length) return [];

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((item) => String(item).trim().replace(/^\uFEFF/, '').trim());
  return dataRows
    .filter((values) => values.some((value) => String(value).trim().length > 0))
    .map((values) => {
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] ?? '';
      });
      return row;
    });
};

const buildCatalogImportPreview = async (rawCsv, { allowCreate = false } = {}) => {
  const rows = parseCsvRows(rawCsv);
  const existing = new Map((await listTracks()).map((track) => [String(track.id), track]));
  const preview = [];
  const errors = [];

  rows.forEach((row, index) => {
    const id = String(row.id ?? '').trim();
    const title = String(row.title ?? '').trim();
    if (!id) {
      errors.push({ row: index + 2, field: 'id', message: 'Missing id value.' });
      return;
    }

    const normalizedGenre = row.genre ? normalizeGenre(row.genre) : null;
    if (row.genre && !normalizedGenre) {
      errors.push({ row: index + 2, field: 'genre', message: `Genre "${row.genre}" is not in the approved vocabulary.` });
    }

    const existingTrack = existing.get(id) || null;
    if (!existingTrack && !allowCreate) {
      errors.push({ row: index + 2, field: 'id', message: `Track ${id} was not found in the catalog.` });
    }

    preview.push({
      id,
      title: title || existingTrack?.title || '',
      existing: existingTrack,
      patch: {
        id,
        title: title || existingTrack?.title || '',
        artist: row.artist ?? existingTrack?.artist ?? '',
        album: row.album ?? existingTrack?.album ?? '',
        genre: normalizedGenre || row.genre || existingTrack?.genre || '',
        subgenres: typeof row.subgenres === 'string' ? row.subgenres.split('|').map((item) => item.trim()).filter(Boolean) : (existingTrack?.subgenres || []),
        mood: row.mood ?? existingTrack?.mood ?? '',
        energy: row.energy ?? existingTrack?.energy ?? '',
        language: row.language ?? existingTrack?.language ?? '',
        genreSource: row.genreSource ?? existingTrack?.genreSource ?? 'csv-import',
        genreConfidence: Number(row.genreConfidence ?? existingTrack?.genreConfidence ?? 0) || 0,
        genreUpdatedAt: row.genreUpdatedAt || new Date().toISOString()
      }
    });
  });

  return {
    ok: !errors.length,
    totalRows: preview.length,
    rows: preview,
    errors
  };
};

const applyCatalogImportPreview = async (previewPayload) => {
  const payload = previewPayload && Array.isArray(previewPayload.rows) ? previewPayload : { rows: [] };
  const before = await listTracks();
  const updates = payload.rows.filter((entry) => entry?.id).map((entry) => ({
    id: String(entry.id),
    ...entry.patch,
    genre: entry.patch.genre || null,
    genreUpdatedAt: entry.patch.genreUpdatedAt || new Date().toISOString()
  }));

  if (updates.length) {
    const { bulkUpdateTrackGenres } = await import('./catalogStore.js');
    await bulkUpdateTrackGenres(updates);
    invalidateCatalogCache();
  }

  const after = await listTracks();
  const importRecord = {
    id: randomUUID(),
    appliedAt: new Date().toISOString(),
    before,
    after,
    updates
  };
  catalogImportHistory.unshift(importRecord);
  return importRecord;
};

const rollbackCatalogImport = async (importId) => {
  const historyItem = catalogImportHistory.find((entry) => entry.id === importId) || catalogImportHistory[0];
  if (!historyItem) return { ok: false, reason: 'No catalog import to roll back.' };

  const rollbackRows = historyItem.before.map((track) => ({ id: track.id, ...track }));
  const { bulkUpdateTrackGenres } = await import('./catalogStore.js');
  await bulkUpdateTrackGenres(rollbackRows);
  invalidateCatalogCache();

  return { ok: true, id: historyItem.id, rolledBack: rollbackRows.length };
};

app.get('/api/admin/catalog.csv', requireAdmin, async (req, res) => {
  return res.status(410).json({ message: 'This endpoint no longer creates import batches. Use POST /api/admin/catalog/exports.' });
});

app.get('/api/admin/catalog/backup.csv', requireAdmin, async (_req, res) => {
  try {
    const tracks = await listTracks();
    const csv = exportCatalogCsv(tracks);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sonara-catalog-backup.csv"');
    return res.send(csv);
  } catch (error) {
    console.error('[catalog backup] failed', error);
    return res.status(500).json({ message: 'Unable to create the catalog backup right now.' });
  }
});

app.get('/api/admin/catalog/export.csv', requireAdmin, async (_req, res) => {
  return res.status(410).json({ message: 'This endpoint no longer creates import batches. Use POST /api/admin/catalog/exports.' });
});

app.post('/api/admin/catalog/import/preview', requireAdmin, async (req, res) => {
  try {
    const csvText = String(req.body?.csv ?? req.body?.content ?? '').trim();
    if (!csvText) return res.status(400).json({ message: 'CSV content is required.' });

    const preview = await buildCatalogImportPreview(csvText, { allowCreate: Boolean(req.body?.allowCreate) });
    return res.json(preview);
  } catch (error) {
    console.error('[catalog import preview] failed', error);
    return res.status(500).json({ message: 'Unable to preview the catalog import right now.' });
  }
});

app.post('/api/admin/catalog/import/apply', requireAdmin, async (req, res) => {
  try {
    const preview = req.body?.preview || req.body;
    if (!preview || !Array.isArray(preview.rows)) {
      const csvText = String(req.body?.csv ?? req.body?.content ?? '').trim();
      if (!csvText) return res.status(400).json({ message: 'CSV content is required.' });
      const generatedPreview = await buildCatalogImportPreview(csvText, { allowCreate: Boolean(req.body?.allowCreate) });
      if (!generatedPreview.ok) return res.status(400).json(generatedPreview);
      return res.json(await applyCatalogImportPreview(generatedPreview));
    }

    if (!preview.ok) return res.status(400).json(preview);
    return res.json(await applyCatalogImportPreview(preview));
  } catch (error) {
    console.error('[catalog import apply] failed', error);
    return res.status(500).json({ message: 'Unable to apply the catalog import right now.' });
  }
});

app.post('/api/admin/catalog/preview', requireAdmin, async (req, res) => {
  const csvText = String(req.body?.csv ?? req.body?.content ?? '').trim();
  if (!csvText) return res.status(400).json({ message: 'CSV content is required.' });
  const preview = await buildCatalogImportPreview(csvText, { allowCreate: Boolean(req.body?.allowCreate) });
  return res.json(preview);
});

app.post('/api/admin/catalog/apply', requireAdmin, async (req, res) => {
  const preview = req.body?.preview || req.body;
  if (!preview || !Array.isArray(preview.rows)) {
    const csvText = String(req.body?.csv ?? req.body?.content ?? '').trim();
    if (!csvText) return res.status(400).json({ message: 'CSV content is required.' });
    const generatedPreview = await buildCatalogImportPreview(csvText, { allowCreate: Boolean(req.body?.allowCreate) });
    if (!generatedPreview.ok) return res.status(400).json(generatedPreview);
    return res.json(await applyCatalogImportPreview(generatedPreview));
  }
  if (!preview.ok) return res.status(400).json(preview);
  return res.json(await applyCatalogImportPreview(preview));
});

app.post('/api/admin/catalog/rollback', requireAdmin, async (req, res) => {
  try {
    const rollback = await rollbackCatalogImport(String(req.body?.importId || ''));
    if (!rollback.ok) return res.status(400).json(rollback);
    return res.json(rollback);
  } catch (error) {
    console.error('[catalog import rollback] failed', error);
    return res.status(500).json({ message: 'Unable to rollback the catalog import right now.' });
  }
});

app.get('/api/admin/catalog/imports', requireAdmin, async (_req, res) => {
  return res.json({ imports: catalogImportHistory.slice(0, 20) });
});

/* -------------------------------------------------------------------------- */
/*  Uploads                                                                   */
/* -------------------------------------------------------------------------- */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 100 }
});

app.post('/api/uploads/bulk', upload.array('files', 100), async (req, res) => {
  if (!isStorageConfigured()) {
    return res.status(503).json({ message: 'Object storage is not configured on the server.' });
  }

  const files = req.files || [];
  const audioFiles = files.filter((file) => isAudioFile(file.originalname));
  const imageFiles = files.filter((file) => isImageFile(file.originalname));

  if (!audioFiles.length) {
    return res.status(400).json({ message: 'No supported audio files were included in this upload.' });
  }

  // Group any image files by their folder so a cover placed alongside a
  // batch of tracks (e.g. an album folder upload) is matched to them.
  const folderOf = (relativePath) => relativePath.split('/').slice(0, -1).join('/');
  const coverByFolder = new Map();
  for (const image of imageFiles) {
    const relativePath = image.originalname.replace(/\\/g, '/');
    coverByFolder.set(folderOf(relativePath), image);
  }

  const tracks = [];
  const failures = [];

  for (const file of audioFiles) {
    try {
      const relativePath = file.originalname.replace(/\\/g, '/');
      const folder = folderOf(relativePath);
      const fileName = relativePath.split('/').pop();

      // Fix: detect mime by extension instead of forcing audio/mpeg, so
      // M4A/FLAC/OGG/etc. actually parse instead of silently failing.
      const mimeType = detectAudioMimeType(fileName, file.mimetype);

      if (/\.(m4a|m4b|m4r|mp4)$/i.test(fileName) && hasLateMoovBox(file.buffer)) {
        console.warn(`[upload] ${fileName} has moov after mdat; streaming may be slow. Optimize with ffmpeg -i in.m4a -c copy -movflags +faststart out.m4a`);
      }

      let parsed = null;
      try {
        parsed = await mm.parseBuffer(file.buffer, mimeType, { skipCovers: false });
      } catch (parseError) {
        console.warn(`[upload] metadata parse failed for ${fileName}:`, parseError.message);
      }

      const duration = Number(parsed?.format?.duration) || 0;
      const metadata = mergeTrackMetadata(parsed?.common, fileName, folder);
      const embeddedGenre = normalizeGenre(parsed?.common?.genre?.[0] || parsed?.common?.genre);

      const objectKey = buildObjectKey(relativePath);
      await putObject(objectKey, file.buffer, mimeType);
      const audioUrl = publicUrlFor(objectKey);

      // Cover priority: an explicitly-uploaded image file in the same
      // folder, then embedded artwork pulled from the audio file's own
      // tags (previously discarded via skipCovers:true), then nothing.
      let coverUrl = '';
      const explicitCover = coverByFolder.get(folder);
      if (explicitCover) {
        const coverKey = buildObjectKey(`${folder ? folder + '/' : ''}cover-${fileName}.${explicitCover.originalname.split('.').pop()}`);
        await putObject(coverKey, explicitCover.buffer, explicitCover.mimetype || 'image/jpeg');
        coverUrl = publicUrlFor(coverKey);
      } else {
        const embedded = parsed?.common?.picture?.[0];
        if (embedded?.data?.length) {
          const ext = String(embedded.format || 'image/jpeg').split('/').pop();
          const coverKey = buildObjectKey(`${folder ? folder + '/' : ''}cover-${fileName}.${ext}`);
          await putObject(coverKey, Buffer.from(embedded.data), embedded.format || 'image/jpeg');
          coverUrl = publicUrlFor(coverKey);
        }
      }

      const id = deriveTrackId(objectKey);
      const uploaderEmail = req.user?.email || null;
      const uploaderName = req.user?.name || req.user?.displayName || uploaderEmail?.split('@')[0] || 'Community Uploader';

      const track = {
        id,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        duration,
        cover: coverUrl,
        audioUrl,
        objectKey,
        source: 'upload',
        uploadedBy: req.user?.uid || uploaderEmail || 'anonymous',
        uploadedByEmail: uploaderEmail,
        uploadedByName: uploaderName,
        fileSizeBytes: file.buffer?.length || 0,
        ...(embeddedGenre ? { genre: embeddedGenre, genreSource: 'tag', genreStatus: 'classified', genreConfidence: 1 } : {}),
        createdAt: new Date().toISOString()
      };

      await upsertTrack(track);
      invalidateCatalogCache();
      tracks.push(track);
    } catch (fileError) {
      console.error(`[upload] failed for ${file.originalname}:`, fileError);
      failures.push({ name: file.originalname, message: fileError.message });
    }
  }

  if (!tracks.length) {
    return res.status(502).json({ message: 'All files in this batch failed to upload.', failures });
  }

  res.json({ tracks, failures });
});

/* -------------------------------------------------------------------------- */
/*  User library (preferences + playlists)                                    */
/* -------------------------------------------------------------------------- */

app.get('/api/me/library', async (req, res) => {
  try {
    if (!req.user) return res.json(buildEmptyLibraryPayload());
    if (!isMongoConfigured()) return res.json(buildEmptyLibraryPayload());

    const db = await getDb();
    const doc = await db.collection('userLibraries').findOne({ uid: req.user.uid });
    const normalized = normalizeLibraryData(doc?.data || buildEmptyLibraryPayload());
    res.json(normalized);
  } catch (error) {
    console.error('[library] read failed', error);
    res.json(buildEmptyLibraryPayload());
  }
});

app.put('/api/me/library', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Sign in to sync your library.' });
    if (!isMongoConfigured()) return res.json({ ok: true, persisted: false });

    const db = await getDb();
    const existing = await db.collection('userLibraries').findOne({ uid: req.user.uid });
    const merged = mergeLibraryData(existing?.data || buildEmptyLibraryPayload(), req.body || {});
    const providedPreferences = req.body?.preferences && typeof req.body.preferences === 'object' ? req.body.preferences : {};
    const currentPreferences = existing?.data?.preferences && typeof existing.data.preferences === 'object' ? existing.data.preferences : {};
    const mergedPreferences = { ...currentPreferences, ...providedPreferences };

    await db.collection('userLibraries').updateOne(
      { uid: req.user.uid },
      { $set: { uid: req.user.uid, 'data.preferences': mergedPreferences, 'data.dailyMixes': merged.dailyMixes, 'data.mixHistory': merged.mixHistory, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ ok: true, persisted: true, data: merged });
  } catch (error) {
    console.error('[library] write failed', error);
    res.status(500).json({ message: 'Unable to sync your library right now.' });
  }
});

app.get('/api/me/playlists', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const legacyDoc = db ? await db.collection('userLibraries').findOne({ uid: req.user.uid }) : null;
    const legacyPlaylists = Array.isArray(legacyDoc?.data?.playlists) ? legacyDoc.data.playlists : [];
    const current = await listUserPlaylists(req.user.uid);

    if (!current.length && legacyPlaylists.length) {
      await migrateLegacyPlaylistsForUser(req.user.uid, legacyPlaylists);
    }

    const playlists = await listUserPlaylists(req.user.uid);
    const since = req.query.since ? Number(req.query.since) : null;
    const payload = JSON.stringify(playlists);
    const etag = `"${Buffer.from(payload).toString('base64url')}"`;

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    if (since && playlists.every((playlist) => !(playlist.updatedAt && new Date(playlist.updatedAt).getTime() > since))) {
      return res.status(304).end();
    }

    res.set('ETag', etag);
    res.json(playlists);
  } catch (error) {
    console.error('[playlists] read failed', error);
    res.status(500).json({ message: 'Unable to load your playlists right now.' });
  }
});

app.post('/api/me/playlists', requireAuth, async (req, res) => {
  try {
    const name = normalizePlaylistName(req.body?.name);
    if (!name || name.length < 1 || name.length > 60) {
      return res.status(400).json({ message: 'Playlist name must be 1-60 characters.' });
    }
    const playlist = await createPlaylistForUser(req.user.uid, name);
    res.status(201).json(playlist);
  } catch (error) {
    if (error.message && /already have a playlist with that name/i.test(error.message)) {
      return res.status(409).json({ message: 'You already have a playlist with that name.' });
    }
    if (error.message && /maximum number of playlists/i.test(error.message)) {
      return res.status(400).json({ message: error.message });
    }
    console.error('[playlists] create failed', error);
    res.status(500).json({ message: 'Unable to create your playlist right now.' });
  }
});

app.patch('/api/me/playlists/:id', requireAuth, async (req, res) => {
  try {
    const name = normalizePlaylistName(req.body?.name);
    if (!name || name.length > 60) {
      return res.status(400).json({ message: 'Playlist name must be 1-60 characters.' });
    }
    const playlist = await renamePlaylistForUser(req.user.uid, req.params.id, name);
    if (!playlist) return res.status(404).json({ message: 'Playlist not found.' });
    res.json(playlist);
  } catch (error) {
    if (error.message && /already have a playlist with that name/i.test(error.message)) {
      return res.status(409).json({ message: 'You already have a playlist with that name.' });
    }
    console.error('[playlists] rename failed', error);
    res.status(500).json({ message: 'Unable to rename your playlist right now.' });
  }
});

app.delete('/api/me/playlists/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await deletePlaylistForUser(req.user.uid, req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Playlist not found.' });
    res.json({ ok: true, deleted: true });
  } catch (error) {
    console.error('[playlists] delete failed', error);
    res.status(500).json({ message: 'Unable to delete your playlist right now.' });
  }
});

app.post('/api/me/playlists/:id/tracks', requireAuth, async (req, res) => {
  try {
    const trackId = String(req.body?.trackId || '').trim();
    if (!trackId) return res.status(400).json({ message: 'A track id is required.' });
    if (!(await trackExists(trackId))) return res.status(404).json({ message: 'Track not found.' });
    const result = await addTrackToPlaylist(req.user.uid, req.params.id, trackId);
    if (!result.playlist) return res.status(404).json({ message: 'Playlist not found.' });
    if (!result.added) return res.json({ added: false, playlist: result.playlist });
    res.status(201).json({ added: true, playlist: result.playlist });
  } catch (error) {
    if (error.message && /maximum number of tracks/i.test(error.message)) {
      return res.status(400).json({ message: error.message });
    }
    console.error('[playlists] add track failed', error);
    res.status(500).json({ message: 'Unable to add the track to your playlist right now.' });
  }
});

app.delete('/api/me/playlists/:id/tracks/:trackId', requireAuth, async (req, res) => {
  try {
    const removed = await removeTrackFromPlaylist(req.user.uid, req.params.id, req.params.trackId);
    if (!removed) return res.status(404).json({ message: 'Playlist or track was not found.' });
    res.json({ ok: true, removed: true });
  } catch (error) {
    console.error('[playlists] remove track failed', error);
    res.status(500).json({ message: 'Unable to remove the track from your playlist right now.' });
  }
});

async function getUserLibraryDocument(uid) {
  if (!uid || !isMongoConfigured()) return { data: buildEmptyLibraryPayload() };
  const db = await getDb();
  const doc = await db.collection('userLibraries').findOne({ uid });
  return { db, data: normalizeLibraryData(doc?.data || buildEmptyLibraryPayload()) };
}

async function upsertUserLibraryDocument(uid, data) {
  if (!uid || !isMongoConfigured()) return null;
  const db = await getDb();
  const payload = normalizeLibraryData(data || buildEmptyLibraryPayload());
  await db.collection('userLibraries').updateOne(
    { uid },
    { $set: { uid, data: payload, updatedAt: new Date() } },
    { upsert: true }
  );
  return payload;
}

app.get('/api/recommendations/daily', async (req, res) => {
  try {
    const request = getRecommendationRequest(req);
    if (request.error) return res.status(400).json({ message: request.error });
    await touchMixOwner(request);
    const catalog = await listTracks();
    let snapshot = await getDailySnapshot(request.ownerKey, request.dateKey);
    if (!snapshot && req.user && request.deviceId) {
      snapshot = await getDailySnapshot(`d:${request.deviceId}`, request.dateKey);
      if (snapshot) {
        snapshot = { ...snapshot, ownerKey: request.ownerKey, ownerUid: req.user.uid };
        const collections = await recommendationCollections();
        if (collections) {
          await collections.dailyMixes.updateOne({ ownerKey: request.ownerKey, dateKey: request.dateKey }, { $setOnInsert: snapshot }, { upsert: true });
        } else {
          memoryDailyMixes.set(`${request.ownerKey}:${request.dateKey}`, snapshot);
        }
      }
    }
    if (!snapshot) snapshot = await createDailySnapshot({ ...request, catalog, uid: req.user?.uid });
    const mixes = await enrichDailyMixes(snapshot, req.user?.uid);
    const nextDateKey = getLocalDateKey(request.timeZone, new Date(Date.now() + 24 * 60 * 60 * 1000));
    const nextSnapshot = await getDailySnapshot(request.ownerKey, nextDateKey);
    const next = nextSnapshot ? await enrichDailyMixes(nextSnapshot, req.user?.uid) : null;
    const payload = JSON.stringify({ dateKey: request.dateKey, nextRefreshAt: `${request.dateKey}T23:59:59.999Z`, mixes, next: next ? { dateKey: nextDateKey, mixes: next } : null });
    const etag = `"${Buffer.from(payload).toString('base64url')}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.set('ETag', etag);
    return res.json(JSON.parse(payload));
  } catch (error) {
    console.error('[recommendations] daily read failed', error);
    return res.status(500).json({ message: 'Unable to load recommendations right now.' });
  }
});

app.post('/api/internal/jobs/daily-mixes', async (req, res) => {
  const configuredSecret = String(process.env.CRON_SECRET || '');
  const suppliedSecret = String(req.headers['x-cron-secret'] || '');
  if (!configuredSecret || suppliedSecret !== configuredSecret) return res.status(401).json({ message: 'Unauthorized.' });
  try {
    return res.json({ ok: true, ...(await precomputeDailyMixes()) });
  } catch (error) {
    console.error('[recommendations] precompute failed', error);
    return res.status(500).json({ message: 'Daily mix precompute failed.' });
  }
});

app.get('/api/me/daily-mix', requireAuth, async (req, res) => {
  try {
    const dateKey = getMixDateKey();
    const library = await getUserLibraryDocument(req.user.uid);
    const currentMix = Array.isArray(library.data.dailyMixes)
      ? library.data.dailyMixes.find((mix) => mix.dateKey === dateKey && mix.owner === req.user.uid)
      : null;

    const catalog = await listTracks();
    const generated = buildDailyMixForCatalog({ catalog, userId: req.user.uid, dateKey, limit: 5 });
    const payload = {
      id: `daily-${dateKey}`,
      name: 'Daily mix',
      dateKey,
      deviceId: String(req.headers['x-device-id'] || 'web').trim() || 'web',
      owner: req.user.uid,
      trackIds: generated.map((track) => String(track.id)),
      tracks: generated,
      createdAt: currentMix?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (currentMix && currentMix.trackIds?.length) {
      payload.trackIds = currentMix.trackIds;
      payload.tracks = currentMix.tracks?.length ? currentMix.tracks : generated;
    }

    const nextDocument = {
      ...library.data,
      dailyMixes: [
        ...(Array.isArray(library.data.dailyMixes) ? library.data.dailyMixes.filter((mix) => mix.dateKey !== dateKey || mix.owner !== req.user.uid) : []),
        payload
      ],
      mixHistory: Array.isArray(library.data.mixHistory) ? library.data.mixHistory.slice(-25) : []
    };

    await upsertUserLibraryDocument(req.user.uid, nextDocument);

    const responseBody = JSON.stringify(payload);
    const etag = `"${Buffer.from(responseBody).toString('base64url')}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.set('ETag', etag);
    res.json(payload);
  } catch (error) {
    console.error('[daily-mix] read failed', error);
    res.status(500).json({ message: 'Unable to load your daily mix right now.' });
  }
});

app.post('/api/me/daily-mix/refresh', requireAuth, async (req, res) => {
  try {
    const dateKey = getMixDateKey();
    const catalog = await listTracks();
    const tracks = buildDailyMixForCatalog({ catalog, userId: req.user.uid, dateKey, limit: 5 });
    const payload = {
      id: `daily-${dateKey}`,
      name: 'Daily mix',
      dateKey,
      deviceId: String(req.headers['x-device-id'] || req.body?.deviceId || 'web').trim() || 'web',
      owner: req.user.uid,
      trackIds: tracks.map((track) => String(track.id)),
      tracks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const library = await getUserLibraryDocument(req.user.uid);
    const nextDocument = {
      ...library.data,
      dailyMixes: [
        ...(Array.isArray(library.data.dailyMixes) ? library.data.dailyMixes.filter((mix) => mix.dateKey !== dateKey || mix.owner !== req.user.uid) : []),
        payload
      ],
      mixHistory: [
        payload,
        ...(Array.isArray(library.data.mixHistory) ? library.data.mixHistory : [])
      ].slice(0, 25)
    };

    await upsertUserLibraryDocument(req.user.uid, nextDocument);
    res.status(201).json(payload);
  } catch (error) {
    console.error('[daily-mix] refresh failed', error);
    res.status(500).json({ message: 'Unable to refresh your daily mix right now.' });
  }
});

app.get('/api/me/mixes', requireAuth, async (req, res) => {
  try {
    const mixes = await listSavedMixes(req.user.uid);
    const payload = JSON.stringify(mixes);
    const etag = `"${Buffer.from(payload).toString('base64url')}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.set('ETag', etag);
    res.json(mixes);
  } catch (error) {
    console.error('[mixes] read failed', error);
    res.status(500).json({ message: 'Unable to load your mixes right now.' });
  }
});

app.post('/api/me/mixes', requireAuth, async (req, res) => {
  try {
    const dailyMixId = String(req.body?.dailyMixId || '').trim();
    const dateKey = String(req.body?.dateKey || '').trim();
    if (!dailyMixId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return res.status(400).json({ message: 'A daily mix id and date are required.' });
    const snapshot = await getDailySnapshot(`u:${req.user.uid}`, dateKey);
    const source = snapshot?.mixes?.find((mix) => mix.id === dailyMixId);
    if (!source) return res.status(404).json({ message: 'Recommended mix not found.' });
    const existing = (await listSavedMixes(req.user.uid)).find((mix) => mix.origin?.mixId === dailyMixId && mix.origin?.dateKey === dateKey);
    if (existing) return res.json(existing);
    const currentCount = (await listSavedMixes(req.user.uid)).length;
    if (currentCount >= 200) return res.status(400).json({ message: 'You have reached the saved mix limit.' });
    const mix = {
      id: randomUUID(), ownerUid: req.user.uid, name: source.name, trackIds: [...source.trackIds].slice(0, 500), kind: 'recommended',
      origin: { dateKey, mixId: source.id, flavor: source.flavor }, createdAt: new Date(), updatedAt: new Date(), editedAt: null
    };
    const collections = await recommendationCollections();
    if (!collections) memorySavedMixes.set(mix.id, mix);
    else {
      try { await collections.savedMixes.insertOne(mix); } catch (error) {
        if (error?.code === 11000) return res.json((await listSavedMixes(req.user.uid)).find((item) => item.origin?.mixId === dailyMixId));
        throw error;
      }
    }
    return res.status(201).json(mix);
  } catch (error) {
    console.error('[mixes] write failed', error);
    res.status(500).json({ message: 'Unable to save your mix right now.' });
  }
});

app.patch('/api/me/mixes/:id', requireAuth, async (req, res) => {
  try {
    const current = await findSavedMix(req.user.uid, req.params.id);
    if (!current) return res.status(404).json({ message: 'Mix not found.' });
    const name = req.body?.name === undefined ? current.name : String(req.body.name).trim();
    if (!name || name.length > 60) return res.status(400).json({ message: 'Mix name must be 1-60 characters.' });
    const currentIds = new Set((current.trackIds || []).map(String));
    const trackIds = req.body?.trackIds === undefined ? current.trackIds : req.body.trackIds;
    if (!Array.isArray(trackIds) || trackIds.length > 500 || new Set(trackIds.map(String)).size !== trackIds.length || trackIds.some((id) => !currentIds.has(String(id)))) {
      return res.status(400).json({ message: 'Track ids must be a unique subset of this mix.' });
    }
    const nextMix = { ...current, name, trackIds: trackIds.map(String), kind: 'personal', editedAt: new Date(), updatedAt: new Date() };
    const collections = await recommendationCollections();
    if (!collections) memorySavedMixes.set(req.params.id, nextMix);
    else await collections.savedMixes.replaceOne({ ownerUid: req.user.uid, id: req.params.id }, nextMix);
    return res.json(nextMix);
  } catch (error) {
    console.error('[mixes] update failed', error);
    res.status(500).json({ message: 'Unable to update your mix right now.' });
  }
});

app.delete('/api/me/mixes/:id', requireAuth, async (req, res) => {
  try {
    const current = await findSavedMix(req.user.uid, req.params.id);
    if (!current) return res.status(404).json({ message: 'Mix not found.' });
    const collections = await recommendationCollections();
    if (!collections) memorySavedMixes.delete(req.params.id);
    else await collections.savedMixes.deleteOne({ ownerUid: req.user.uid, id: req.params.id });
    return res.json({ ok: true, deleted: true, id: req.params.id });
  } catch (error) {
    console.error('[mixes] delete failed', error);
    res.status(500).json({ message: 'Unable to delete your mix right now.' });
  }
});

app.get('/api/me/profile', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Sign in to load your profile.' });
    const profile = await getUserProfile(req.user.uid);
    res.json({ profile });
  } catch (error) {
    console.error('[profile] read failed', error);
    res.status(500).json({ message: 'Unable to load your profile right now.' });
  }
});

app.put('/api/me/profile', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Sign in to save your profile.' });
    const username = String(req.body?.username || '').trim();
    const validationError = validateUsername(username);
    if (validationError) return res.status(400).json({ message: validationError });
    const profile = await saveUserProfile({ uid: req.user.uid, email: req.user.email, username });
    res.json({ profile });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'That username is already in use.' });
    console.error('[profile] write failed', error);
    res.status(500).json({ message: 'Unable to save your profile right now.' });
  }
});

/* -------------------------------------------------------------------------- */
/*  Admin & Billing API                                                       */
/* -------------------------------------------------------------------------- */

app.get('/api/admin/check', async (_req, res) => {
  try {
    const admin = await getAdminConfig();
    res.json({
      hasAdmin: Boolean(admin),
      adminEmail: admin?.email || null,
      claimedAt: admin?.claimedAt || null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/me', async (req, res) => {
  try {
    const isAdmin = await isAdminUser(req.user);
    const admin = await getAdminConfig();
    res.json({
      isAdmin,
      userEmail: req.user?.email || null,
      adminEmail: admin?.email || null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/admin/claim', requireAuth, async (req, res) => {
  try {
    const existing = await getAdminConfig();
    if (existing) {
      return res.status(403).json({ message: 'Admin account has already been claimed.' });
    }

    if (!req.user?.email || !req.user?.email_verified) {
      return res.status(403).json({ message: 'A verified email is required to claim admin access.' });
    }

    const email = req.user.email;
    const uid = req.user.uid;
    const displayName = req.user.name || req.user.displayName || email.split('@')[0];

    const result = await claimAdmin({ uid, email, displayName });
    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    res.json({ ok: true, admin: result.admin });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const admin = await getAdminConfig();
    if (!admin) {
      return res.status(403).json({ message: 'Access denied: no admin has been claimed.' });
    }

    const tracks = await listTracks();
    const R2_COST_PER_GB_USD = 0.015; // $0.015/GB beyond 10GB free tier

    const userMap = new Map();
    let totalBytes = 0;

    for (const track of tracks) {
      const size = Number(track.fileSizeBytes) || (5 * 1024 * 1024); // fallback ~5MB
      totalBytes += size;

      const userKey = track.uploadedByEmail || track.uploadedBy || 'Community';
      const userName = track.uploadedByName || userKey.split('@')[0] || 'Community Uploader';

      if (!userMap.has(userKey)) {
        userMap.set(userKey, {
          userKey,
          email: track.uploadedByEmail || (userKey.includes('@') ? userKey : 'N/A'),
          displayName: userName,
          trackCount: 0,
          totalBytes: 0,
          tracks: []
        });
      }

      const userData = userMap.get(userKey);
      userData.trackCount += 1;
      userData.totalBytes += size;
      userData.tracks.push({
        id: track.id,
        title: track.title,
        artist: track.artist,
        sizeBytes: size,
        createdAt: track.createdAt
      });
    }

    const totalGB = totalBytes / (1024 * 1024 * 1024);
    const freeTierGB = 10;
    const billableGB = Math.max(0, totalGB - freeTierGB);
    const totalEstimatedMonthlyCostUSD = billableGB * R2_COST_PER_GB_USD;

    const userBreakdown = Array.from(userMap.values()).map((u) => {
      const userGB = u.totalBytes / (1024 * 1024 * 1024);
      const userShare = totalBytes > 0 ? (u.totalBytes / totalBytes) : 0;
      const userBillableGB = Math.max(0, userGB - (freeTierGB * userShare));
      return {
        userKey: u.userKey,
        email: u.email,
        displayName: u.displayName,
        trackCount: u.trackCount,
        totalBytes: u.totalBytes,
        totalMB: Number((u.totalBytes / (1024 * 1024)).toFixed(2)),
        totalGB: Number(userGB.toFixed(3)),
        sharePercentage: Number((userShare * 100).toFixed(1)),
        estimatedMonthlyCostUSD: Number((userBillableGB * R2_COST_PER_GB_USD).toFixed(4))
      };
    }).sort((a, b) => b.totalBytes - a.totalBytes);

    res.json({
      ok: true,
      admin: admin || null,
      summary: {
        totalTracks: tracks.length,
        totalUsers: userBreakdown.length,
        totalStorageBytes: totalBytes,
        totalStorageMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
        totalStorageGB: Number(totalGB.toFixed(3)),
        r2FreeTierGB: freeTierGB,
        billableGB: Number(billableGB.toFixed(3)),
        totalEstimatedMonthlyCostUSD: Number(totalEstimatedMonthlyCostUSD.toFixed(4)),
        costPerGBUSD: R2_COST_PER_GB_USD
      },
      userBreakdown
    });
  } catch (error) {
    console.error('[admin stats] error', error);
    res.status(500).json({ message: error.message });
  }
});

/* -------------------------------------------------------------------------- */
/*  Errors                                                                    */
/* -------------------------------------------------------------------------- */

app.use((error, _req, res, _next) => {
  console.error('[unhandled]', error);
  if (res.headersSent) return;
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

const port = Number(process.env.PORT) || 4000;
cron.schedule('0 * * * *', () => {
  precomputeDailyMixes().catch((error) => console.error('[recommendations] hourly precompute failed', error));
});
app.listen(port, '0.0.0.0', () => {
  console.log(`Sonara backend running on http://0.0.0.0:${port}`);
  console.log(`Catalog store: ${storageMode()} | Object storage: ${isStorageConfigured() ? 'configured' : 'NOT configured'} | Auth: ${isFirebaseConfigured() ? 'configured' : 'disabled'}`);
  migrateGenreStatuses().catch((error) => console.error('[catalog] genre status migration failed:', error.message));
});

export default app;
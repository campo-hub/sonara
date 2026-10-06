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
import { verifyIdToken, getFirebaseUserRecord, isFirebaseConfigured } from './firebaseAdmin.js';
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
import { resolveUploaderIdentity } from './adminStatsUtils.js';
import { getAdminJob, listRecentAdminJobs, startAdminJob } from './adminJobs.js';
import { generateDailyMixSnapshot, generateUniversalDailyMixSnapshot, getPlayableTracks } from './recommendationUtils.js';
import { getAllowedGenres, normalizeGenre } from './genres.js';
import { buildGenreAwareDailyMix, buildGenrePlaylists, exportCatalogCsv } from './genreMixUtils.js';

const app = express();
app.use(compression());
app.use(express.json({ limit: '2mb' }));

const memoryDailyMixes = new Map();
const memoryUniversalDailyMixes = new Map();
const memoryMixHistory = new Map();
const memorySavedMixes = new Map();
const firebaseUserCache = new Map();
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

const getCachedFirebaseUser = async (uid) => {
  const cached = firebaseUserCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  try {
    const user = await getFirebaseUserRecord(uid);
    firebaseUserCache.set(uid, { user, expiresAt: Date.now() + 5 * 60 * 1000 });
    return user;
  } catch {
    firebaseUserCache.set(uid, { user: null, expiresAt: Date.now() + 60 * 1000 });
    return null;
  }
};

const recommendationCollections = async () => {
  if (!isMongoConfigured()) return null;
  const db = await getDb();
  const dailyMixes = db.collection('dailyMixes');
  const universalDailyMixes = db.collection('universalDailyMixes');
  const mixHistory = db.collection('mixHistory');
  const savedMixes = db.collection('savedMixes');
  const mixOwners = db.collection('mixOwners');
  await Promise.all([
    dailyMixes.createIndex({ ownerKey: 1, dateKey: 1 }, { unique: true }),
    dailyMixes.createIndex({ createdAt: 1 }, { expireAfterSeconds: 8 * 24 * 60 * 60 }),
    universalDailyMixes.createIndex({ dateKey: 1 }, { unique: true }),
    universalDailyMixes.createIndex({ createdAt: 1 }, { expireAfterSeconds: 8 * 24 * 60 * 60 }),
    mixHistory.createIndex({ ownerKey: 1 }, { unique: true }),
    mixHistory.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }),
    savedMixes.createIndex({ ownerUid: 1, updatedAt: -1 }),
    savedMixes.createIndex({ ownerUid: 1, 'origin.mixId': 1 }, { unique: true }),
    mixOwners.createIndex({ ownerKey: 1 }, { unique: true }),
    mixOwners.createIndex({ lastSeenAt: 1 })
  ]);
  return { dailyMixes, universalDailyMixes, mixHistory, savedMixes, mixOwners };
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

const getUniversalDateKey = (now = new Date()) => getLocalDateKey(process.env.DAILY_MIX_TIMEZONE || 'UTC', now);

const getUniversalSnapshot = async (dateKey) => {
  const collections = await recommendationCollections();
  if (!collections) return memoryUniversalDailyMixes.get(dateKey) || null;
  return collections.universalDailyMixes.findOne({ dateKey }, { projection: { _id: 0 } });
};

const universalGenerationPromises = new Map();

export const precomputeUniversalDailyMix = async ({ now = new Date() } = {}) => {
  const dateKey = getUniversalDateKey(now);
  const existing = await getUniversalSnapshot(dateKey);
  if (existing) return { dateKey, generated: false, snapshot: existing };
  if (universalGenerationPromises.has(dateKey)) return universalGenerationPromises.get(dateKey);

  const generation = (async () => {
    const catalog = (await getCatalogSnapshot()).tracks;
    const generated = generateUniversalDailyMixSnapshot({ catalog, dateKey });
    const snapshot = { ...generated, createdAt: new Date() };
    const collections = await recommendationCollections();
    if (!collections) {
      memoryUniversalDailyMixes.set(dateKey, snapshot);
      return { dateKey, generated: true, snapshot };
    }
    await collections.universalDailyMixes.updateOne({ dateKey }, { $setOnInsert: snapshot }, { upsert: true });
    return { dateKey, generated: true, snapshot: (await getUniversalSnapshot(dateKey)) || snapshot };
  })();

  universalGenerationPromises.set(dateKey, generation);
  try {
    return await generation;
  } finally {
    universalGenerationPromises.delete(dateKey);
  }
};

const getUniversalSnapshotOrPrevious = async (dateKey) => {
  const current = await getUniversalSnapshot(dateKey);
  if (current) return current;

  const previousDate = new Date(`${dateKey}T00:00:00.000Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const previousKey = previousDate.toISOString().slice(0, 10);
  const previous = await getUniversalSnapshot(previousKey);
  void precomputeUniversalDailyMix().catch((error) => console.error('[recommendations] background generation failed', error));
  return previous;
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

const sendEtaggedJson = (req, res, payload, cacheControl = 'private, max-age=15, stale-while-revalidate=30') => {
  const body = JSON.stringify(payload);
  const etag = `"${Buffer.from(body).toString('base64url')}"`;
  res.set({ ETag: etag, 'Cache-Control': cacheControl, 'Content-Type': 'application/json; charset=utf-8' });
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  return res.send(body);
};

const sendEtaggedText = (req, res, body, contentType, filename) => {
  const etag = `"${Buffer.from(body).toString('base64url')}"`;
  res.set({ ETag: etag, 'Cache-Control': 'private, max-age=60', 'Content-Type': contentType });
  if (filename) res.set('Content-Disposition', `attachment; filename="${filename}"`);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  return res.send(body);
};

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
    res.set({ ETag: snapshot.etag, 'Cache-Control': 'public, max-age=30, stale-while-revalidate=300' });
    if (req.headers['if-none-match'] === snapshot.etag) return res.status(304).end();
    void maybeSyncBucket();
    return res.json({ songs: snapshot.tracks });
  } catch (error) {
    console.error('[catalog] failed', error);
    return res.status(500).json({ message: 'Unable to load the catalog right now.' });
  }
});

app.get('/api/admin/genres/vocabulary', requireAdmin, async (_req, res) => {
  const genres = getAllowedGenres();
  return sendEtaggedJson(_req, res, { genres, count: genres.length });
});

app.get('/api/admin/jobs/:jobId', requireAdmin, async (req, res) => {
  const job = getAdminJob(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Admin job not found.' });
  return sendEtaggedJson(req, res, job, 'no-store');
});

app.get('/api/admin/activity', requireAdmin, async (req, res) => {
  const actions = listRecentAdminJobs(50).map(({ jobId, status, step, done, total, message, error, createdAt, updatedAt }) => ({
    jobId, status, step, done, total, message, error, createdAt, updatedAt
  }));
  return sendEtaggedJson(req, res, { actions });
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

let genrePlaylistCache = { catalogEtag: '', etag: '', payload: [] };

app.get('/api/genres/playlists', async (req, res) => {
  try {
    const catalog = await getCatalogSnapshot();
    if (genrePlaylistCache.catalogEtag !== catalog.etag) {
      const payload = buildGenrePlaylists(catalog.tracks);
      const body = JSON.stringify(payload);
      genrePlaylistCache = {
        catalogEtag: catalog.etag,
        etag: `"${Buffer.from(body).toString('base64url')}"`,
        payload
      };
    }

    res.set({ ETag: genrePlaylistCache.etag, 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' });
    if (req.headers['if-none-match'] === genrePlaylistCache.etag) return res.status(304).end();
    return res.json(genrePlaylistCache.payload);
  } catch (error) {
    console.error('[genres] playlist generation failed', error);
    return res.status(500).json({ message: 'Unable to load genre playlists.' });
  }
});

app.get('/api/admin/catalog/genres/untagged', requireAdmin, async (req, res) => {
  try {
    const catalog = await getCatalogSnapshot();
    const tracks = catalog.tracks.filter((track) => !normalizeGenre(track.genre));
    return sendEtaggedJson(req, res, { trackCount: tracks.length, trackIds: tracks.map((track) => String(track.id)) });
  } catch (error) {
    console.error('[admin genres] untagged tracks failed', error);
    return res.status(500).json({ message: 'Unable to load untagged tracks.' });
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

const applyBatchImport = async (preview, { report = () => {}, step = () => {} } = {}) => {
  const batch = await getExportBatch(preview.batchId);
  if (!batch) return { ok: false, message: 'Export batch not found.' };
  const changed = [];
  const accepted = preview.accepted || [];
  step('Applying classified tracks', `Applying ${accepted.length} accepted rows.`);
  for (let index = 0; index < accepted.length; index += 1) {
    const item = accepted[index];
    const current = await getTrackById(item.id);
    if (current) {
      const changedTrack = await updateTrackIf(
        item.id,
        { genreStatus: current.genreStatus === 'exported' ? 'exported' : current.genreStatus, exportBatchId: preview.batchId },
        item.patch
      );
      if (changedTrack) changed.push(item.id);
    }
    report({ step: 'Applying classified tracks', done: index + 1, total: accepted.length, message: `Applying ${index + 1} of ${accepted.length}` });
  }
  const updatedBatch = await updateBatchStatus(preview.batchId);
  if (changed.length) invalidateCatalogCache();
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
  return sendEtaggedText(req, res, csv, 'text/csv; charset=utf-8', `sonara-${batch.batchId}.csv`);
});

app.get('/api/admin/catalog/pending-count', requireAdmin, async (req, res) => {
  const counts = await buildAdminPendingCounts();
  return sendEtaggedJson(req, res, counts);
});

app.get('/api/admin/catalog/exports', requireAdmin, async (req, res) => {
  const batches = await buildAdminBatchList();
  return sendEtaggedJson(req, res, { batches });
});

const releaseBatchTracks = async (batchId, { report = () => {}, step = () => {} } = {}) => {
  const batch = await getExportBatch(batchId);
  if (!batch) return null;
  let released = 0;
  const trackIds = batch.trackIds || [];
  step('Finding outstanding tracks', `${trackIds.length} tracks in batch ${batchId}.`);
  for (let index = 0; index < trackIds.length; index += 1) {
    const id = trackIds[index];
    if (await updateTrackIf(id, { genreStatus: 'exported', exportBatchId: batchId }, { genreStatus: 'pending', exportBatchId: null, exportedAt: null })) released += 1;
    report({ step: 'Marking as queued', done: index + 1, total: trackIds.length, message: `Re-queuing ${index + 1} of ${trackIds.length}` });
  }
  step('Saving batch state', `Saving ${released} queued tracks.`);
  await updateExportBatch(batchId, { status: 'released', releasedCount: released });
  return { batchId, released };
};

app.post('/api/admin/catalog/exports/:batchId/release', requireAdmin, async (req, res) => {
  const batch = await getExportBatch(req.params.batchId);
  if (!batch) return res.status(404).json({ message: 'Export batch not found.' });
  return res.status(202).json(startAdminJob({
    label: `Release batch ${batch.batchId}`,
    total: (batch.trackIds || []).length,
    run: async ({ report, step }) => {
      const result = await releaseBatchTracks(batch.batchId, { report, step });
      return { ...result, message: `Released ${result?.released || 0} outstanding tracks in ${batch.batchId}.` };
    }
  }));
});

app.post('/api/admin/catalog/exports/:batchId/requeue-outstanding', requireAdmin, async (req, res) => {
  const batch = await getExportBatch(req.params.batchId);
  if (!batch) return res.status(404).json({ message: 'Export batch not found.' });
  return res.status(202).json(startAdminJob({
    label: `Re-queue batch ${batch.batchId}`,
    total: (batch.trackIds || []).length,
    run: async ({ report, step }) => {
      const result = await releaseBatchTracks(batch.batchId, { report, step });
      return { ...result, message: `Re-queued ${result?.released || 0} outstanding tracks in ${batch.batchId}.` };
    }
  }));
});

app.post('/api/admin/catalog/exports/:batchId/rollback', requireAdmin, async (req, res) => {
  const batch = await getExportBatch(req.params.batchId);
  if (!batch) return res.status(404).json({ message: 'Export batch not found.' });
  return res.status(202).json(startAdminJob({
    label: `Rollback batch ${batch.batchId}`,
    total: (batch.previous || []).length,
    run: async ({ report, step }) => {
      let restored = 0;
      const previous = batch.previous || [];
      step('Restoring prior track states', `Restoring ${previous.length} tracks.`);
      for (let index = 0; index < previous.length; index += 1) {
        const item = previous[index];
        if (item.state && await getTrackById(item.id)) {
          const { _id, ...state } = item.state;
          await updateTrackIf(item.id, {}, state);
          restored += 1;
        }
        report({ step: 'Restoring prior track states', done: index + 1, total: previous.length, message: `Restored ${index + 1} of ${previous.length}` });
      }
      await updateExportBatch(batch.batchId, { status: 'released', rolledBack: true });
      return { ok: true, batchId: batch.batchId, restored, message: `Restored ${restored} tracks from batch ${batch.batchId}.` };
    }
  }));
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
    return res.status(202).json(startAdminJob({
      label: `Apply import batch ${preview.batchId}`,
      total: Array.isArray(preview.accepted) ? preview.accepted.length : 0,
      run: async ({ report, step }) => {
        const result = await applyBatchImport(preview, { report, step });
        if (!result.ok) throw new Error(result.message || 'Unable to apply this batch.');
        return { ...result, message: `Imported ${result.changed.length} tracks from batch ${result.batchId}.` };
      }
    }));
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

app.get('/api/admin/catalog/backup.csv', requireAdmin, async (req, res) => {
  try {
    const tracks = await listTracks();
    const csv = exportCatalogCsv(tracks);
    return sendEtaggedText(req, res, csv, 'text/csv; charset=utf-8', 'sonara-catalog-backup.csv');
  } catch (error) {
    console.error('[catalog backup] failed', error);
    return res.status(500).json({ message: 'Unable to create the catalog backup right now.' });
  }
});

app.get('/api/admin/catalog/export.csv', requireAdmin, async (_req, res) => {
  return res.status(410).json({ message: 'This endpoint no longer creates import batches. Use POST /api/admin/catalog/exports.' });
});

app.post('/api/admin/catalog/import/preview', requireAdmin, async (req, res) => {
  return res.status(410).json({ message: 'Use POST /api/admin/catalog/import/batch/preview so the batch ID is validated.' });
});

app.post('/api/admin/catalog/import/apply', requireAdmin, async (req, res) => {
  return res.status(410).json({ message: 'Use POST /api/admin/catalog/import/batch/apply so the batch ID is validated.' });
});

app.post('/api/admin/catalog/preview', requireAdmin, async (req, res) => {
  return res.status(410).json({ message: 'Use POST /api/admin/catalog/import/batch/preview so the batch ID is validated.' });
});

app.post('/api/admin/catalog/apply', requireAdmin, async (req, res) => {
  return res.status(410).json({ message: 'Use POST /api/admin/catalog/import/batch/apply so the batch ID is validated.' });
});

app.post('/api/admin/catalog/rollback', requireAdmin, async (req, res) => {
  try {
    const importId = String(req.body?.importId || '');
    const history = catalogImportHistory.find((entry) => entry.id === importId) || catalogImportHistory[0];
    if (!history) return res.status(400).json({ ok: false, reason: 'No catalog import to roll back.' });
    return res.status(202).json(startAdminJob({
      label: `Rollback catalog import ${history.id}`,
      total: history.before.length,
      run: async ({ report, step }) => {
        step('Restoring catalog genre values', `Restoring ${history.before.length} tracks.`);
        const rollback = await rollbackCatalogImport(history.id);
        if (!rollback.ok) throw new Error(rollback.reason || 'Unable to rollback this import.');
        report({ step: 'Saving restored catalog', done: rollback.rolledBack, total: history.before.length, message: `Restored ${rollback.rolledBack} tracks.` });
        return { ...rollback, message: `Restored ${rollback.rolledBack} tracks from import ${history.id}.` };
      }
    }));
  } catch (error) {
    console.error('[catalog import rollback] failed', error);
    return res.status(500).json({ message: 'Unable to rollback the catalog import right now.' });
  }
});

app.get('/api/admin/catalog/imports', requireAdmin, async (req, res) => {
  return sendEtaggedJson(req, res, { imports: catalogImportHistory.slice(0, 20) });
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
      const uploaderProfile = req.user?.uid ? await getUserProfile(req.user.uid).catch(() => null) : null;
      const uploaderEmail = uploaderProfile?.email || req.user?.email || null;
      const uploaderName = uploaderProfile?.username || req.user?.name || req.user?.displayName || uploaderEmail?.split('@')[0] || 'Community Uploader';

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
    const dateKey = getUniversalDateKey();
    const snapshot = await getUniversalSnapshotOrPrevious(dateKey);
    const payload = JSON.stringify({
      dateKey: snapshot?.dateKey || dateKey,
      nextRefreshAt: `${dateKey}T23:59:59.999Z`,
      stale: Boolean(snapshot && snapshot.dateKey !== dateKey),
      mixes: snapshot?.mixes || []
    });
    const etag = `"${Buffer.from(payload).toString('base64url')}"`;
    res.set({ ETag: etag, 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
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
    const result = await precomputeUniversalDailyMix();
    return res.json({ ok: true, dateKey: result.dateKey, generated: result.generated });
  } catch (error) {
    console.error('[recommendations] precompute failed', error);
    return res.status(500).json({ message: 'Daily mix precompute failed.' });
  }
});

const buildLegacyUniversalMix = async ({ uid, deviceId, createdAt = new Date().toISOString() }) => {
  let snapshot = await getUniversalSnapshotOrPrevious(getUniversalDateKey());
  if (!snapshot) snapshot = (await precomputeUniversalDailyMix()).snapshot;
  const mix = snapshot?.mixes?.[0] || { name: 'Daily Mix', trackIds: [], flavor: 'daily' };
  const catalog = (await getCatalogSnapshot()).tracks;
  const byId = new Map(getPlayableTracks(catalog).map((track) => [track.id, track]));
  const tracks = (mix.trackIds || []).map((id) => byId.get(String(id))).filter(Boolean);
  const dateKey = snapshot?.dateKey || getUniversalDateKey();
  return {
    id: `daily-${dateKey}`,
    name: mix.name || 'Daily Mix',
    dateKey,
    deviceId: String(deviceId || 'web').trim() || 'web',
    owner: uid,
    trackIds: tracks.map((track) => String(track.id)),
    tracks,
    createdAt,
    updatedAt: new Date().toISOString()
  };
};

app.get('/api/me/daily-mix', requireAuth, async (req, res) => {
  try {
    const library = await getUserLibraryDocument(req.user.uid);
    const currentMix = Array.isArray(library.data.dailyMixes)
      ? library.data.dailyMixes.find((mix) => mix.dateKey === getUniversalDateKey() && mix.owner === req.user.uid)
      : null;
    const payload = await buildLegacyUniversalMix({ uid: req.user.uid, deviceId: req.headers['x-device-id'], createdAt: currentMix?.createdAt });

    const nextDocument = {
      ...library.data,
      dailyMixes: [
        ...(Array.isArray(library.data.dailyMixes) ? library.data.dailyMixes.filter((mix) => mix.dateKey !== payload.dateKey || mix.owner !== req.user.uid) : []),
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
    const library = await getUserLibraryDocument(req.user.uid);
    const payload = await buildLegacyUniversalMix({ uid: req.user.uid, deviceId: req.headers['x-device-id'] || req.body?.deviceId });
    const nextDocument = {
      ...library.data,
      dailyMixes: [
        ...(Array.isArray(library.data.dailyMixes) ? library.data.dailyMixes.filter((mix) => mix.dateKey !== payload.dateKey || mix.owner !== req.user.uid) : []),
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
    const snapshot = await getUniversalSnapshot(dateKey);
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

const buildAdminStatsPayload = async () => {
  const admin = await getAdminConfig();
  if (!admin) return null;
  const tracks = await listTracks();
  const configuredRate = Number(process.env.R2_COST_PER_GB_USD);
  const costPerGBUSD = Number.isFinite(configuredRate) && configuredRate >= 0 ? configuredRate : 0.015;
  const configuredBudget = Number(process.env.R2_MONTHLY_BUDGET_USD);
  const monthlyBudgetUSD = Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : null;
  const identitiesByUid = new Map();
  const uploaderUids = [...new Set(tracks.map((track) => String(track.uploadedBy || '')).filter((value) => value && !value.includes('@') && !['anonymous', 'community'].includes(value.toLowerCase())))];

  await Promise.all(uploaderUids.map(async (uid) => {
    const profile = await getUserProfile(uid).catch(() => null);
    const firebaseUser = (!profile?.username || !profile?.email) && isFirebaseConfigured() ? await getCachedFirebaseUser(uid) : null;
    const sourceTrack = tracks.find((track) => String(track.uploadedBy || '') === uid) || { uploadedBy: uid };
    const identity = resolveUploaderIdentity(sourceTrack, profile, firebaseUser);
    identitiesByUid.set(uid, identity);
    if (firebaseUser && identity.email) {
      const candidate = identity.displayName === 'Unknown user' ? identity.email.split('@')[0] : identity.displayName;
      if (candidate && !validateUsername(candidate)) {
        await saveUserProfile({ uid, email: identity.email, username: candidate }).catch(() => {});
      }
    }
  }));

  const userMap = new Map();
  let totalBytes = 0;
  for (const track of tracks) {
    const size = Number(track.fileSizeBytes) || (5 * 1024 * 1024);
    totalBytes += size;
    const identity = identitiesByUid.get(String(track.uploadedBy || '')) || resolveUploaderIdentity(track);
    if (!userMap.has(identity.userKey)) {
      userMap.set(identity.userKey, { ...identity, trackCount: 0, totalBytes: 0 });
    }
    const userData = userMap.get(identity.userKey);
    userData.trackCount += 1;
    userData.totalBytes += size;
  }

  const totalGB = totalBytes / (1024 ** 3);
  const configuredFreeTier = Number(process.env.R2_FREE_TIER_GB);
  const freeTierGB = Number.isFinite(configuredFreeTier) && configuredFreeTier >= 0 ? configuredFreeTier : 10;
  const billableGB = Math.max(0, totalGB - freeTierGB);
  const totalEstimatedMonthlyCostUSD = billableGB * costPerGBUSD;
  const userBreakdown = [...userMap.values()].map((user) => {
    const userGB = user.totalBytes / (1024 ** 3);
    const userShare = totalBytes > 0 ? user.totalBytes / totalBytes : 0;
    const userBillableGB = Math.max(0, userGB - freeTierGB * userShare);
    return {
      userKey: user.userKey,
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      trackCount: user.trackCount,
      totalBytes: user.totalBytes,
      totalMB: Number((user.totalBytes / (1024 ** 2)).toFixed(2)),
      totalGB: Number(userGB.toFixed(3)),
      sharePercentage: Number((userShare * 100).toFixed(1)),
      estimatedMonthlyCostUSD: Number((userBillableGB * costPerGBUSD).toFixed(4))
    };
  }).sort((left, right) => right.totalBytes - left.totalBytes);

  return {
    ok: true,
    admin,
    summary: {
      totalTracks: tracks.length,
      totalUsers: userBreakdown.length,
      totalStorageBytes: totalBytes,
      totalStorageMB: Number((totalBytes / (1024 ** 2)).toFixed(2)),
      totalStorageGB: Number(totalGB.toFixed(3)),
      r2FreeTierGB: freeTierGB,
      billableGB: Number(billableGB.toFixed(3)),
      totalEstimatedMonthlyCostUSD: Number(totalEstimatedMonthlyCostUSD.toFixed(4)),
      costPerGBUSD,
      monthlyBudgetUSD,
      overBudget: monthlyBudgetUSD !== null && totalEstimatedMonthlyCostUSD > monthlyBudgetUSD
    },
    userBreakdown
  };
};

const buildAdminPendingCounts = async () => {
  await migrateGenreStatuses();
  const counts = { pending: 0, exported: 0, classified: 0, needsReview: 0 };
  for (const track of await listTracks()) {
    if (track.genreStatus === 'pending') counts.pending += 1;
    if (track.genreStatus === 'exported') counts.exported += 1;
    if (track.genreStatus === 'classified') counts.classified += 1;
    if (track.genreStatus === 'needs_review') counts.needsReview += 1;
  }
  return counts;
};

const buildAdminBatchList = async () => {
  const batches = await listExportBatches();
  const result = [];
  for (const batch of batches) {
    const current = await updateBatchStatus(batch.batchId);
    const ageDays = Math.floor((Date.now() - new Date(batch.createdAt).getTime()) / 86400000);
    result.push({ ...current, ageDays, stale: ageDays > 7 });
  }
  return result;
};

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const payload = await buildAdminStatsPayload();
    if (!payload) return res.status(403).json({ message: 'Access denied: no admin has been claimed.' });
    return sendEtaggedJson(req, res, payload, 'private, max-age=60, stale-while-revalidate=60');
  } catch (error) {
    console.error('[admin stats] error', error);
    return res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/summary', requireAdmin, async (req, res) => {
  try {
    const [stats, pending, batches] = await Promise.all([
      buildAdminStatsPayload(), buildAdminPendingCounts(), buildAdminBatchList()
    ]);
    if (!stats) return res.status(403).json({ message: 'Access denied: no admin has been claimed.' });
    return sendEtaggedJson(req, res, { stats, pending, recentBatches: batches.slice(0, 10) }, 'private, max-age=15, stale-while-revalidate=30');
  } catch (error) {
    console.error('[admin summary] error', error);
    return res.status(500).json({ message: error.message });
  }
});

app.post('/api/admin/identities/backfill', requireAdmin, async (_req, res) => {
  try {
    const tracks = await listTracks();
    const targets = tracks.filter((track) => {
      const uid = String(track.uploadedBy || '');
      return uid && !uid.includes('@') && !['anonymous', 'community'].includes(uid.toLowerCase());
    });
    return res.status(202).json(startAdminJob({
      label: 'Backfill uploader identities',
      total: targets.length,
      run: async ({ report, step }) => {
        let updated = 0;
        const identityByUid = new Map();
        step('Resolving saved profiles', `Checking ${targets.length} uploaded tracks.`);
        for (let index = 0; index < targets.length; index += 1) {
          const track = targets[index];
          const uid = String(track.uploadedBy);
          let identity = identityByUid.get(uid);
          if (!identity) {
            const profile = await getUserProfile(uid).catch(() => null);
            const firebaseUser = (!profile?.username || !profile?.email) && isFirebaseConfigured() ? await getCachedFirebaseUser(uid) : null;
            identity = resolveUploaderIdentity(track, profile, firebaseUser);
            identityByUid.set(uid, identity);
            if (firebaseUser && identity.email) {
              const candidate = identity.displayName === 'Unknown user' ? identity.email.split('@')[0] : identity.displayName;
              if (candidate && !validateUsername(candidate)) await saveUserProfile({ uid, email: identity.email, username: candidate }).catch(() => {});
            }
          }
          const patch = {};
          if (identity.displayName !== 'Unknown user' && identity.displayName !== 'Community') patch.uploadedByName = identity.displayName;
          if (identity.email) patch.uploadedByEmail = identity.email;
          if (Object.keys(patch).length) {
            const result = await updateTrackIf(track.id, {}, patch);
            if (result) updated += 1;
          }
          report({ step: 'Writing track identity', done: index + 1, total: targets.length, message: `Updated ${updated} of ${targets.length} tracks` });
        }
        invalidateCatalogCache();
        return { updated, total: targets.length, message: `Backfilled uploader identity on ${updated} tracks.` };
      }
    }));
  } catch (error) {
    console.error('[admin identity backfill] failed', error);
    return res.status(500).json({ message: 'Unable to start identity backfill.' });
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
cron.schedule(String(process.env.DAILY_MIX_CRON || '5 0 * * *'), () => {
  precomputeUniversalDailyMix().catch((error) => console.error('[recommendations] daily precompute failed', error));
}, { timezone: process.env.DAILY_MIX_TIMEZONE || 'UTC' });
app.listen(port, '0.0.0.0', () => {
  console.log(`Sonara backend running on http://0.0.0.0:${port}`);
  console.log(`Catalog store: ${storageMode()} | Object storage: ${isStorageConfigured() ? 'configured' : 'NOT configured'} | Auth: ${isFirebaseConfigured() ? 'configured' : 'disabled'}`);
  migrateGenreStatuses().catch((error) => console.error('[catalog] genre status migration failed:', error.message));
});

export default app;
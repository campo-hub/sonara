import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as mm from 'music-metadata';

import {
  isAudioFile,
  isImageFile,
  detectAudioMimeType,
  buildObjectKey,
  deriveTrackId,
  mergeTrackMetadata,
  parseTrackMetadataFromName,
  buildFallbackCatalog
} from './uploadUtils.js';
import { isStorageConfigured, listObjects, putObject, publicUrlFor } from './storage.js';
import { upsertTrack, listTracks, storageMode, isMongoConfigured, getDb, trackExists } from './catalogStore.js';
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

const app = express();
app.use(express.json({ limit: '2mb' }));

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

async function maybeSyncBucket() {
  if (!isStorageConfigured()) return;
  if (Date.now() - lastSyncAttemptAt < SYNC_INTERVAL_MS) return;
  lastSyncAttemptAt = Date.now();
  try {
    const result = await syncBucketIntoCatalog({ listObjects, publicUrlFor, upsertTrack, listTracks });
    lastSync = { ran: true, ok: true, at: new Date().toISOString(), ...result };
    console.log('[catalog] bucket sync', result);
  } catch (error) {
    // Retry soon, and never let a sync problem take down the catalog itself.
    lastSyncAttemptAt = Date.now() - SYNC_INTERVAL_MS + SYNC_RETRY_MS;
    lastSync = { ran: true, ok: false, at: new Date().toISOString(), error: error.message };
    console.error('[catalog] bucket sync failed (serving stored tracks):', error.message);
  }
}

app.get('/api/catalog', async (_req, res) => {
  try {
    await maybeSyncBucket();
    const tracks = await listTracks();
    return res.json({ songs: tracks });
  } catch (error) {
    console.error('[catalog] failed', error);
    return res.status(500).json({ message: 'Unable to load the catalog right now.' });
  }
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

      let parsed = null;
      try {
        parsed = await mm.parseBuffer(file.buffer, mimeType, { skipCovers: false });
      } catch (parseError) {
        console.warn(`[upload] metadata parse failed for ${fileName}:`, parseError.message);
      }

      const duration = Number(parsed?.format?.duration) || 0;
      const metadata = mergeTrackMetadata(parsed?.common, fileName, folder);

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
        createdAt: new Date().toISOString()
      };

      await upsertTrack(track);
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

    await db.collection('userLibraries').updateOne(
      { uid: req.user.uid },
      { $set: { uid: req.user.uid, data: merged, updatedAt: new Date() } },
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
app.listen(port, '0.0.0.0', () => {
  console.log(`Sonara backend running on http://0.0.0.0:${port}`);
  console.log(`Catalog store: ${storageMode()} | Object storage: ${isStorageConfigured() ? 'configured' : 'NOT configured'} | Auth: ${isFirebaseConfigured() ? 'configured' : 'disabled'}`);
});

export default app;
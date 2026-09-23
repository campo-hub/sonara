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
  buildFallbackCatalog
} from './uploadUtils.js';
import { isStorageConfigured, putObject, publicUrlFor } from './storage.js';
import { upsertTrack, listTracks, storageMode, isMongoConfigured } from './catalogStore.js';
import { buildEmptyLibraryPayload } from './libraryUtils.js';
import { verifyIdToken, isFirebaseConfigured } from './firebaseAdmin.js';

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

if (!configuredOrigins.length) {
  console.warn('[cors] CORS_ORIGIN is not set - allowing all origins. Set CORS_ORIGIN in production.');
}

app.use(
  cors({
    origin(origin, callback) {
      if (!configuredOrigins.length) return callback(null, true);
      if (!origin) return callback(null, true); // curl/health checks/no Origin header
      if (configuredOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed.`));
    }
  })
);

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
app.get('/api/catalog', async (_req, res) => {
  try {
    const tracks = await listTracks();
    if (!tracks.length && String(process.env.SEED_FALLBACK_CATALOG || '').toLowerCase() === 'true') {
      // Explicit opt-in only (env flag), so demo/sample tracks never
      // silently mix into a real deployment's catalog unless asked for.
      return res.json({ songs: buildFallbackCatalog() });
    }
    res.json({ songs: tracks });
  } catch (error) {
    console.error('[catalog] failed to list tracks', error);
    res.status(500).json({ message: 'Unable to load the catalog right now.' });
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
        uploadedBy: req.user?.uid || null,
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

    const { getTrackCollection } = await import('./catalogStore.js');
    const col = await getTrackCollection();
    const db = col.s.db; // reuse the already-connected Mongo client's db handle
    const doc = await db.collection('userLibraries').findOne({ uid: req.user.uid });
    res.json(doc?.data || buildEmptyLibraryPayload());
  } catch (error) {
    console.error('[library] read failed', error);
    // Degrade gracefully: an empty library, not a 500, so the frontend
    // never has to special-case a broken backend into a broken UI.
    res.json(buildEmptyLibraryPayload());
  }
});

app.put('/api/me/library', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Sign in to sync your library.' });
    if (!isMongoConfigured()) return res.json({ ok: true, persisted: false });

    const { getTrackCollection } = await import('./catalogStore.js');
    const col = await getTrackCollection();
    const db = col.s.db;
    await db
      .collection('userLibraries')
      .updateOne({ uid: req.user.uid }, { $set: { uid: req.user.uid, data: req.body, updatedAt: new Date() } }, { upsert: true });
    res.json({ ok: true, persisted: true });
  } catch (error) {
    console.error('[library] write failed', error);
    res.status(500).json({ message: 'Unable to sync your library right now.' });
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

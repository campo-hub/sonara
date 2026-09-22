import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import multer from 'multer';
import { MongoClient } from 'mongodb';
import * as mm from 'music-metadata';
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { buildFallbackCatalog, buildObjectKey, buildPublicUrl, detectAudioMimeType, isAudioFile, isImageFile } from './uploadUtils.js';
import { buildEmptyLibraryPayload } from './libraryUtils.js';
import { NodeHttpHandler } from '@smithy/node-http-handler';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

const upload = multer({ storage: multer.memoryStorage() });

const firebaseAdminConfigured = Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
if (firebaseAdminConfigured && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!firebaseAdminConfigured) {
    if (process.env.NODE_ENV === 'development' && !token) {
      req.user = { uid: `anonymous-${req.ip || 'local'}-${Date.now()}` };
      return next();
    }
    return res.status(401).json({ message: 'Sign in is required for this action.' });
  }

  if (!token) return res.status(401).json({ message: 'Sign in is required for this action.' });

  try {
    req.user = await admin.auth().verifyIdToken(token);
    return next();
  } catch {
    return res.status(401).json({ message: 'Your sign-in has expired. Please sign in again.' });
  }
}

const defaultOrigins = [
  'http://localhost:5173',
  'https://campo-hub.github.io',
  'https://campo-hub.github.io/sonara',
  'https://sonara-senm.onrender.com',
  'https://sonara-xgmr.onrender.com'
];

const allowedOrigins = [...new Set([
  ...defaultOrigins,
  ...(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
])];

const allowOriginHeader = (origin) => {
  if (!origin) return '*';
  const normalized = origin.trim();
  return allowedOrigins.includes(normalized) ? normalized : '*';
};

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = allowOriginHeader(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});
app.use(express.json({ limit: '50mb' }));

app.get('/', (_, res) => {
  res.json({
    status: 'ok',
    service: 'sonara-backend',
    message: 'Sonara backend API is running.',
    endpoints: ['/api/health', '/api/catalog', '/api/featured']
  });
});

app.get('/api', (_, res) => {
  res.json({
    status: 'ok',
    service: 'sonara-backend',
    message: 'Sonara backend API is running.',
    endpoints: ['/api/health', '/api/catalog', '/api/featured', '/api/me/library']
  });
});

app.get('/health', (_, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'sonara-backend',
    timestamp: new Date().toISOString()
  });
});

app.get('/test', (_, res) => {
  res.status(200).json({
    message: 'Express is responding',
    timestamp: new Date().toISOString()
  });
});

const catalog = [];
const uploadedTracks = [];
const catalogMetadataCache = new Map();
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

function mergeCatalog(items = []) {
  const deduped = new Map();
  const sources = [...catalog, ...uploadedTracks, ...items];

  for (const item of sources) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.id || item._id || item.audioUrl || item.url || item.title || '');
    if (!key) continue;
    deduped.set(key, { ...item });
  }

  return [...deduped.values()].filter((item) => item && (item.audioUrl || item.url || item.source === 'bucket'));
}

async function withTimeout(promise, ms, label = 'request') {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]);
}

const r2BucketName = process.env.R2_BUCKET_NAME || '';
const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2PublicBaseUrl = process.env.R2_PUBLIC_BASE_URL || '';
const r2Endpoint = process.env.R2_ENDPOINT || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '');
const r2Client = r2BucketName && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
  ? new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: r2Endpoint,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      },
      forcePathStyle: false,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5000,
        socketTimeout: 10000,
        maxSockets: 20
      })
    })
  : null;

const mongoClient = process.env.MONGODB_URI
  ? new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      tls: true
    })
  : null;
let mongoDatabasePromise = null;

async function getMongoDatabase() {
  if (!mongoClient) return null;
  if (!mongoDatabasePromise) {
    mongoDatabasePromise = mongoClient.connect()
      .then((client) => client.db(process.env.MONGODB_DB_NAME || 'sonara'))
      .catch((error) => {
        mongoDatabasePromise = null;
        console.error('MongoDB connection unavailable:', error.message || error);
        return null;
      });
  }
  return mongoDatabasePromise;
}

async function getUserLibrary(userId) {
  const database = await getMongoDatabase();
  if (!database) {
    return buildEmptyLibraryPayload();
  }
  return database.collection('userLibraries').findOne({ userId });
}

async function saveUserLibrary(userId, payload) {
  const database = await getMongoDatabase();
  const library = {
    userId,
    preferences: payload.preferences || {},
    playlists: Array.isArray(payload.playlists) ? payload.playlists : [],
    updatedAt: new Date()
  };

  if (!database) {
    return library;
  }

  await database.collection('userLibraries').updateOne({ userId }, { $set: library }, { upsert: true });
  return library;
}

function cleanName(fileName = '') {
  return fileName
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function parseTrackMetadata(fileName, folderPath = '') {
  const rawName = cleanName(fileName).replace(/\s+/g, ' ');
  const folderName = folderPath.split('/').filter(Boolean).at(-1) || '';

  const artistMatch = rawName.match(/^(.*?)[\s\-–—]+(.+)$/);
  const byDash = artistMatch ? artistMatch[1].trim() : null;
  const trackTitle = artistMatch ? artistMatch[2].trim() : rawName;

  return {
    title: trackTitle || rawName || 'Untitled Track',
    artist: byDash || 'Unknown Artist',
    album: folderName || 'Untitled Album'
  };
}

function resolveUploadPath(file, fallbackDir = 'uploads') {
  const candidatePath = file.webkitRelativePath || file.originalname || file.fieldname || 'upload';
  return buildObjectKey(candidatePath, fallbackDir);
}

async function uploadToR2(file, key) {
  if (!r2Client || !r2BucketName) {
    return {
      key,
      url: buildPublicUrl(key, r2PublicBaseUrl)
    };
  }

  try {
    await r2Client.send(new PutObjectCommand({
      Bucket: r2BucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || 'application/octet-stream'
    }));

    const finalUrl = r2PublicBaseUrl || `${r2Endpoint}/${r2BucketName}/${key}`;
    return {
      key,
      url: buildPublicUrl(key, finalUrl.replace(new RegExp(`/${r2BucketName}/?$`), ''))
    };
  } catch (error) {
    console.error('Cloudflare R2 upload failed:', error);
    throw new Error(`R2 upload failed: ${error.message || 'storage unavailable'}`);
  }
}

function detectAlbumCover(files = []) {
  const ranked = files
    .filter((file) => isImageFile(file.originalname) || file.fieldname === 'cover')
    .sort((a, b) => {
      const aIsCover = /cover|front|art|folder/i.test(a.originalname) ? 1 : 0;
      const bIsCover = /cover|front|art|folder/i.test(b.originalname) ? 1 : 0;
      return bIsCover - aIsCover;
    });

  return ranked[0] || null;
}

function getParentFolder(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 1 ? segments.slice(0, -1).join('/').toLowerCase() : '';
}

function buildCoverMap(files = []) {
  const coversByFolder = new Map();
  files
    .filter((file) => isImageFile(file.originalname) || file.fieldname === 'cover')
    .sort((a, b) => {
      const aIsCover = /cover|front|art|folder/i.test(a.originalname) ? 1 : 0;
      const bIsCover = /cover|front|art|folder/i.test(b.originalname) ? 1 : 0;
      return bIsCover - aIsCover;
    })
    .forEach((file) => {
      const folder = getParentFolder(file.webkitRelativePath || file.originalname);
      if (!coversByFolder.has(folder)) coversByFolder.set(folder, file);
    });

  return coversByFolder;
}

async function getAudioDurationFromBuffer(buffer, mimeType = 'application/octet-stream', fileName = '') {
  const candidates = [...new Set([
    detectAudioMimeType(fileName, mimeType),
    mimeType,
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/flac',
    'audio/ogg',
    'audio/opus',
    'application/octet-stream'
  ].filter(Boolean))];

  for (const candidate of candidates) {
    try {
      const metadata = await mm.parseBuffer(buffer, candidate, { skipCovers: true });
      const duration = Number(metadata?.format?.duration) || 0;
      if (duration > 0) return duration;
    } catch {
      // Try the next candidate if the mime type is not recognized for this file.
    }
  }

  return 0;
}

async function getAudioDurationFromObjectKey(objectKey) {
  if (!r2Client || !r2BucketName) return 0;

  try {
    const response = await r2Client.send(new GetObjectCommand({
      Bucket: r2BucketName,
      Key: objectKey
    }));

    const chunks = [];
    for await (const chunk of response.Body || []) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    return getAudioDurationFromBuffer(buffer, 'application/octet-stream', objectKey);
  } catch {
    return 0;
  }
}

function buildTrackIdFromKey(objectKey = '') {
  const normalized = String(objectKey || '').replace(/^\/+/, '').replace(/\\/g, '/');
  return `track-${normalized || 'unknown'}`;
}

function buildUploadedTrack(file, index, cover, audioUrl, duration = 0, objectKey = '') {
  const sourcePath = objectKey || file.webkitRelativePath || file.originalname || 'upload';
  const folderPath = sourcePath.includes('/') ? sourcePath.split('/').slice(0, -1).join('/') : '';
  const metadata = parseTrackMetadata((sourcePath.split('/').at(-1) || file.originalname || 'track'), folderPath);

  return {
    id: buildTrackIdFromKey(sourcePath),
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    duration,
    cover: cover || '',
    audioUrl: audioUrl || '',
    source: 'upload',
    status: 'ready'
  };
}

function buildBucketTrackFromKey(objectKey, coverKey = '', duration = 0) {
  const normalized = String(objectKey || '').replace(/^\/+/, '').replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments.at(-1) || 'track';
  const folderPath = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
  const metadata = parseTrackMetadata(fileName, folderPath);
  return {
    id: buildTrackIdFromKey(normalized),
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    duration,
    cover: coverKey ? buildPublicUrl(coverKey, r2PublicBaseUrl || `${r2Endpoint}/${r2BucketName}`) : '',
    audioUrl: buildPublicUrl(normalized, r2PublicBaseUrl || `${r2Endpoint}/${r2BucketName}`),
    source: 'bucket',
    status: 'ready'
  };
}

let catalogScanPromise = null;

async function loadCatalogFromBucket() {
  if (catalogScanPromise) return catalogScanPromise;

  catalogScanPromise = (async () => {
    const response = await r2Client.send(new ListObjectsV2Command({
      Bucket: r2BucketName,
      Prefix: '',
      MaxKeys: 200
    }));

    const keys = (response.Contents || []).map((item) => item.Key).filter(Boolean);
    const audioItems = keys.filter((key) => isAudioFile(key)).slice(0, 50);

    return audioItems.map((key) => buildBucketTrackFromKey(key, '', 0));
  })();

  try {
    return await catalogScanPromise;
  } finally {
    catalogScanPromise = null;
  }
}

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', service: 'sonara-backend', storage: r2Client ? 'cloudflare-r2' : 'memory-fallback', userLibrary: mongoClient ? 'mongodb-configured' : 'not-configured' });
});

app.get('/api/me/library', requireAuth, async (req, res) => {
  try {
    const library = await getUserLibrary(req.user.uid);
    return res.json({
      preferences: library?.preferences || {},
      playlists: Array.isArray(library?.playlists) ? library.playlists : []
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load your library.' });
  }
});

app.put('/api/me/library', requireAuth, async (req, res) => {
  try {
    const library = await saveUserLibrary(req.user.uid, req.body || {});
    return res.json({
      preferences: library.preferences || {},
      playlists: Array.isArray(library.playlists) ? library.playlists : []
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to save your library.' });
  }
});

app.get('/api/catalog', async (_, res) => {
  try {
    console.log('Catalog request received');
    const bucketTracks = await withTimeout(loadCatalogFromBucket(), 15000, 'R2 catalog scan');
    console.log(`Catalog scan completed with ${bucketTracks.length} tracks`);
    return res.json({ songs: mergeCatalog(bucketTracks) });
  } catch (error) {
    console.error('Catalog request failed:', error);
    return res.status(504).json({
      message: 'Catalog request timed out or failed while reading storage.',
      error: error.message || 'Unknown catalog error'
    });
  }
});

app.get('/api/catalog/:id', async (req, res) => {
  try {
    const bucketTracks = await withTimeout(loadCatalogFromBucket(), 15000, 'R2 catalog lookup');
    const song = mergeCatalog(bucketTracks).find((item) => item.id === req.params.id);
    if (!song) {
      return res.status(404).json({ message: 'Song not found' });
    }
    return res.json(song);
  } catch (error) {
    console.error('Catalog lookup failed:', error);
    return res.status(504).json({ message: 'Catalog lookup timed out or failed.', error: error.message || 'Unknown lookup error' });
  }
});

app.get('/api/featured', async (_, res) => {
  try {
    const bucketTracks = await withTimeout(loadCatalogFromBucket(), 15000, 'Featured catalog scan');
    const songs = mergeCatalog(bucketTracks);
    return res.json({
      curated: [songs[0], songs[2] || songs[0]],
      trending: songs.slice(0, 6),
      mood: 'Late-night glow'
    });
  } catch (error) {
    console.error('Featured route failed:', error);
    return res.status(504).json({ message: 'Featured request timed out or failed.', error: error.message || 'Unknown featured error' });
  }
});

app.get('/api/uploads', async (_, res) => {
  try {
    const bucketTracks = await withTimeout(loadCatalogFromBucket(), 15000, 'Uploads catalog scan');
    return res.json({ uploads: mergeCatalog(bucketTracks) });
  } catch (error) {
    console.error('Uploads route failed:', error);
    return res.status(504).json({ message: 'Uploads request timed out or failed.', error: error.message || 'Unknown uploads error' });
  }
});

app.post('/api/uploads/bulk', requireAuth, upload.any(), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const audioFiles = files.filter((file) => isAudioFile(file.originalname));

    if (!audioFiles.length) {
      return res.status(400).json({ message: 'No audio files were uploaded.' });
    }

    const coverMap = buildCoverMap(files);
    const fallbackCover = detectAlbumCover(files);
    const uploadedCovers = new Map();

    const getCoverUrl = async (file) => {
      const folder = getParentFolder(file.webkitRelativePath || file.originalname);
      const coverFile = coverMap.get(folder) || (folder ? null : fallbackCover);
      if (!coverFile) return '';
      const coverPath = coverFile.webkitRelativePath || coverFile.originalname;
      const coverKey = resolveUploadPath(coverFile, 'uploads/covers');
      if (!uploadedCovers.has(coverPath)) {
        const coverUpload = await uploadToR2(coverFile, coverKey);
        uploadedCovers.set(coverPath, coverUpload.url);
      }
      return uploadedCovers.get(coverPath);
    };

    const parsedTracks = await Promise.all(audioFiles.map(async (file, index) => {
      const objectKey = resolveUploadPath(file, 'uploads');
      const uploadResult = await uploadToR2(file, objectKey);
      const duration = await getAudioDurationFromBuffer(
        file.buffer,
        file.mimetype || 'application/octet-stream',
        file.originalname || file.webkitRelativePath || file.fieldname || objectKey
      );
      const track = buildUploadedTrack(file, index, await getCoverUrl(file), uploadResult.url, duration, objectKey);
      catalogMetadataCache.set(`catalog:${objectKey}`, { fetchedAt: Date.now(), track });
      return track;
    }));

    uploadedTracks.unshift(...parsedTracks);

    return res.json({
      success: true,
      uploaded: parsedTracks.length,
      album: parsedTracks[0]?.album || 'Untitled Album',
      tracks: parsedTracks,
      storage: r2Client ? 'cloudflare-r2' : 'memory-fallback'
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Bulk upload failed.' });
  }
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Sonara backend running on http://0.0.0.0:${port}`);
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the existing Sonara backend or choose a different PORT value.`);
    process.exit(1);
  }

  console.error('Server failed to start:', error);
  process.exit(1);
});

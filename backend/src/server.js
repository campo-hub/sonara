import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { buildObjectKey, buildPublicUrl, isAudioFile, isImageFile } from './uploadUtils.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

const upload = multer({ storage: multer.memoryStorage() });

const defaultOrigins = [
  'http://localhost:5173',
  'https://campo-hub.github.io',
  'https://campo-hub.github.io/sonara'
];

const allowedOrigins = [...new Set([
  ...defaultOrigins,
  ...(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
])];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = origin.replace(/\/+$/, '');
    if (allowedOrigins.some((allowed) => allowed.replace(/\/+$/, '') === normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error('CORS blocked for this origin'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));

const catalog = [];
const uploadedTracks = [];

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
      forcePathStyle: false
    })
  : null;

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

function buildUploadedTrack(file, index, cover, audioUrl) {
  const sourcePath = file.webkitRelativePath || file.originalname || 'upload';
  const folderPath = sourcePath.includes('/') ? sourcePath.split('/').slice(0, -1).join('/') : '';
  const metadata = parseTrackMetadata((sourcePath.split('/').at(-1) || file.originalname || 'track'), folderPath);

  return {
    id: `uploaded-${Date.now()}-${index}`,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    duration: 0,
    cover: cover || '',
    audioUrl: audioUrl || '',
    source: 'upload',
    status: 'ready'
  };
}

function buildBucketTrackFromKey(objectKey, index = 0) {
  const normalized = String(objectKey || '').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments.at(-1) || 'track';
  const folderPath = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
  const metadata = parseTrackMetadata(fileName, folderPath);
  const coverCandidates = ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.png'];
  const hasCover = coverCandidates.some((candidate) => normalized.toLowerCase().includes(candidate.toLowerCase()));

  return {
    id: `bucket-${normalized}`,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    duration: 0,
    cover: hasCover ? buildPublicUrl(normalized, r2PublicBaseUrl || `${r2Endpoint}/${r2BucketName}`) : '',
    audioUrl: buildPublicUrl(normalized, r2PublicBaseUrl || `${r2Endpoint}/${r2BucketName}`),
    source: 'bucket',
    status: 'ready'
  };
}

async function loadCatalogFromBucket() {
  if (!r2Client || !r2BucketName) {
    return [];
  }

  try {
    const response = await r2Client.send(new ListObjectsV2Command({
      Bucket: r2BucketName,
      Prefix: 'uploads/'
    }));

    const objects = Array.isArray(response.Contents) ? response.Contents : [];
    const audioItems = objects
      .map((item) => item.Key)
      .filter((key) => isAudioFile(key) || /^uploads\//i.test(key))
      .filter((key) => isAudioFile(key));

    return audioItems.map((key, index) => buildBucketTrackFromKey(key, index));
  } catch (error) {
    console.error('Unable to list Cloudflare R2 catalog:', error);
    return [];
  }
}

function mergeCatalog(bucketTracks = []) {
  const merged = [...catalog, ...uploadedTracks, ...bucketTracks];
  const byId = new Map();

  merged.forEach((track) => {
    if (!track || !track.id) return;
    byId.set(track.id, track);
  });

  return [...byId.values()];
}

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', service: 'sonara-backend', storage: r2Client ? 'cloudflare-r2' : 'memory-fallback' });
});

app.get('/api/catalog', async (_, res) => {
  const bucketTracks = await loadCatalogFromBucket();
  res.json({ songs: mergeCatalog(bucketTracks) });
});

app.get('/api/catalog/:id', async (req, res) => {
  const bucketTracks = await loadCatalogFromBucket();
  const song = mergeCatalog(bucketTracks).find((item) => item.id === req.params.id);
  if (!song) {
    return res.status(404).json({ message: 'Song not found' });
  }
  return res.json(song);
});

app.get('/api/featured', async (_, res) => {
  const bucketTracks = await loadCatalogFromBucket();
  const songs = mergeCatalog(bucketTracks);
  res.json({
    curated: [songs[0], songs[2] || songs[0]],
    trending: songs.slice(0, 6),
    mood: 'Late-night glow'
  });
});

app.get('/api/uploads', async (_, res) => {
  const bucketTracks = await loadCatalogFromBucket();
  res.json({ uploads: mergeCatalog(bucketTracks) });
});

app.post('/api/uploads/bulk', upload.any(), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const audioFiles = files.filter((file) => isAudioFile(file.originalname));

    if (!audioFiles.length) {
      return res.status(400).json({ message: 'No audio files were uploaded.' });
    }

    const coverFile = detectAlbumCover(files);
    const coverUpload = coverFile
      ? await uploadToR2(coverFile, resolveUploadPath(coverFile, 'uploads/covers'))
      : null;

    const parsedTracks = await Promise.all(audioFiles.map(async (file, index) => {
      const objectKey = resolveUploadPath(file, 'uploads');
      const uploadResult = await uploadToR2(file, objectKey);
      return buildUploadedTrack(file, index, coverUpload?.url || null, uploadResult.url);
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

app.listen(port, '0.0.0.0', () => {
  console.log(`Sonara backend running on http://0.0.0.0:${port}`);
});

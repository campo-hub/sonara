import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { buildObjectKey, buildPublicUrl, isAudioFile, isImageFile } from './uploadUtils.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

const upload = multer({ storage: multer.memoryStorage() });

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('CORS blocked for this origin'));
  },
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

const catalog = [
  {
    id: '1',
    title: 'Midnight Drive',
    artist: 'Nova Echo',
    album: 'Afterglow',
    duration: 205,
    cover: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=800&q=80',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
  },
  {
    id: '2',
    title: 'Velvet Static',
    artist: 'Aster Vale',
    album: 'Night Bloom',
    duration: 248,
    cover: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=800&q=80',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3'
  },
  {
    id: '3',
    title: 'Neon Horizon',
    artist: 'Prism Avenue',
    album: 'City Lights',
    duration: 222,
    cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=80',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3'
  }
];

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
    duration: 180 + index * 8,
    cover: cover || 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=800&q=80',
    audioUrl: audioUrl || 'https://example.com/uploads/placeholder.mp3',
    source: 'upload',
    status: 'ready'
  };
}

function mergeCatalog() {
  return [...catalog, ...uploadedTracks];
}

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', service: 'sonara-backend', storage: r2Client ? 'cloudflare-r2' : 'memory-fallback' });
});

app.get('/api/catalog', (_, res) => {
  res.json({ songs: mergeCatalog() });
});

app.get('/api/catalog/:id', (req, res) => {
  const song = mergeCatalog().find((item) => item.id === req.params.id);
  if (!song) {
    return res.status(404).json({ message: 'Song not found' });
  }
  return res.json(song);
});

app.get('/api/featured', (_, res) => {
  const songs = mergeCatalog();
  res.json({
    curated: [songs[0], songs[2] || songs[0]],
    trending: songs.slice(0, 6),
    mood: 'Late-night glow'
  });
});

app.get('/api/uploads', (_, res) => {
  res.json({ uploads: uploadedTracks });
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

app.listen(port, () => {
  console.log(`Sonara backend running on http://localhost:${port}`);
});

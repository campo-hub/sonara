import crypto from 'crypto';

/* -------------------------------------------------------------------------- */
/*  File-type detection                                                       */
/* -------------------------------------------------------------------------- */

const AUDIO_EXT_MIME = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  m4r: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma'
};

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);

const extname = (name = '') => {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
};

export const isAudioFile = (name = '') => Boolean(AUDIO_EXT_MIME[extname(name)]);

export const isImageFile = (name = '') => IMAGE_EXTENSIONS.has(extname(name));

/**
 * Real backend fix: previously the server always forced `audio/mpeg` when
 * asking music-metadata to parse a file. M4A/AAC/FLAC/OGG files would then
 * fail to parse silently, so duration came back as 0. This picks the mime
 * type from the actual file extension first, and only uses generic
 * fallbacks after that.
 */
export const detectAudioMimeType = (name = '', fallbackMime = '') => {
  const byExtension = AUDIO_EXT_MIME[extname(name)];
  if (byExtension) return byExtension;
  if (fallbackMime && fallbackMime !== 'application/octet-stream') return fallbackMime;
  return 'application/octet-stream';
};

/* -------------------------------------------------------------------------- */
/*  Object keys / URLs                                                        */
/* -------------------------------------------------------------------------- */

const sanitizeSegment = (segment = '') =>
  segment
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-');

/** Builds a deterministic R2 object key from an (optionally nested) upload path. */
export const buildObjectKey = (relativePath, rootDir = 'uploads') => {
  const cleanPath = String(relativePath || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(sanitizeSegment)
    .filter(Boolean);
  const unique = crypto.randomBytes(4).toString('hex');
  const fileName = cleanPath.pop() || 'file';
  const dotIndex = fileName.lastIndexOf('.');
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : '';
  const finalName = `${base}-${unique}${ext}`;
  return [rootDir, ...cleanPath, finalName].filter(Boolean).join('/');
};

export const buildPublicUrl = (key, base) => {
  if (!key) return '';
  const trimmedBase = String(base || '').replace(/\/+$/, '');
  const trimmedKey = String(key).replace(/^\/+/, '');
  return trimmedBase ? `${trimmedBase}/${trimmedKey}` : `/${trimmedKey}`;
};

/**
 * Stable, deterministic track id derived from the R2 object key.
 * This is the single ID scheme used everywhere (on upload, on catalog
 * read, on rescans) so the same file never produces two different ids
 * depending on which code path discovered it.
 */
export const deriveTrackId = (objectKey) =>
  `t_${crypto.createHash('sha1').update(String(objectKey || '')).digest('hex').slice(0, 20)}`;

/* -------------------------------------------------------------------------- */
/*  Metadata parsing from file names                                          */
/* -------------------------------------------------------------------------- */

const cleanName = (fileName = '') =>
  fileName
    .replace(/\.[^/.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .trim();

export function parseTrackMetadataFromName(fileName, folderPath = '') {
  const rawName = cleanName(fileName).replace(/\s+/g, ' ');
  const folderName = folderPath.split('/').filter(Boolean).at(-1) || '';
  const dashMatch = rawName.match(/^(.+?)\s-\s(.+)$/);

  return {
    title: (dashMatch ? dashMatch[2] : rawName) || 'Untitled Track',
    artist: (dashMatch ? dashMatch[1] : '') || 'Unknown Artist',
    album: folderName || 'Untitled Album'
  };
}

/**
 * Combines embedded ID3/MP4 tag metadata (preferred, when present) with
 * filename-derived guesses (fallback), so a properly tagged file shows its
 * real title/artist/album instead of a filename guess.
 */
export function mergeTrackMetadata(tagCommon, fileName, folderPath) {
  const fromName = parseTrackMetadataFromName(fileName, folderPath);
  return {
    title: (tagCommon?.title && String(tagCommon.title).trim()) || fromName.title,
    artist: (tagCommon?.artist && String(tagCommon.artist).trim()) || fromName.artist,
    album: (tagCommon?.album && String(tagCommon.album).trim()) || fromName.album
  };
}

/* -------------------------------------------------------------------------- */
/*  Optional local dev sample catalog (never mixed into real uploads)         */
/* -------------------------------------------------------------------------- */

export function buildFallbackCatalog() {
  const samples = [
    { title: 'Night Drive', artist: 'North Echo', album: 'Afterglow', duration: 214 },
    { title: 'Velvet Run', artist: 'Cinder Avenue', album: 'Night Circuit', duration: 247 },
    { title: 'Dream State', artist: 'Glass Harbor', album: 'Warm Static', duration: 201 },
    { title: 'Hollow Glow', artist: 'Daybreak Ritual', album: 'Low Tide', duration: 218 },
    { title: 'Lunar Kite', artist: 'Harbor Echo', album: 'Cassette Air', duration: 261 }
  ];
  return samples.map((song, index) => ({
    id: `seed-${index}`,
    ...song,
    cover: '',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-' + ((index % 6) + 1) + '.mp3',
    source: 'fallback',
    status: 'ready',
    createdAt: new Date(Date.now() - index * 1000).toISOString()
  }));
}

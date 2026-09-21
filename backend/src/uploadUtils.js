export function normalizeRelativeKey(filePath = '') {
  const value = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = value
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== '.' && part !== '..');

  return parts.length ? parts.join('/') : 'untitled-file';
}

export function buildObjectKey(filePath = '', prefix = 'uploads') {
  const normalized = normalizeRelativeKey(filePath);
  const key = normalized.startsWith(`${prefix}/`) ? normalized : `${prefix}/${normalized}`;
  return key.replace(/\/+/g, '/');
}

export function buildPublicUrl(key = '', publicBaseUrl = '') {
  const cleanKey = String(key || '').replace(/^\/+/, '');
  const base = String(publicBaseUrl || '').replace(/\/+$/, '');

  if (!cleanKey) {
    return base || '';
  }

  return base ? `${base}/${cleanKey}` : cleanKey;
}

export function isAudioFile(fileName = '') {
  const name = String(fileName || '').toLowerCase();
  return [
    '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus',
    '.mp4', '.m4b', '.m4r'
  ].some((ext) => name.endsWith(ext));
}

export function detectAudioMimeType(fileName = '', mimeType = '') {
  const name = String(fileName || '').toLowerCase();
  const normalizedMime = String(mimeType || '').toLowerCase();

  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.flac')) return 'audio/flac';
  if (name.endsWith('.m4a') || name.endsWith('.mp4') || name.endsWith('.m4b') || name.endsWith('.m4r')) return 'audio/mp4';
  if (name.endsWith('.aac')) return 'audio/aac';
  if (name.endsWith('.ogg') || name.endsWith('.oga')) return 'audio/ogg';
  if (name.endsWith('.opus')) return 'audio/opus';

  if (normalizedMime.includes('mpeg')) return 'audio/mpeg';
  if (normalizedMime.includes('wav')) return 'audio/wav';
  if (normalizedMime.includes('flac')) return 'audio/flac';
  if (normalizedMime.includes('mp4') || normalizedMime.includes('m4a')) return 'audio/mp4';
  if (normalizedMime.includes('aac')) return 'audio/aac';
  if (normalizedMime.includes('ogg')) return 'audio/ogg';
  if (normalizedMime.includes('opus')) return 'audio/opus';

  return normalizedMime || 'audio/mpeg';
}

export function isImageFile(fileName = '') {
  return ['.jpg', '.jpeg', '.png', '.webp'].some((ext) =>
    String(fileName).toLowerCase().endsWith(ext)
  );
}

export function buildFallbackCatalog() {
  const albumSeeds = [
    { title: 'Night Drive', artist: 'North Echo', album: 'Afterglow', duration: 214, cover: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80', audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
    { title: 'Velvet Run', artist: 'Glass Harbor', album: 'Soft Signal', duration: 196, cover: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
    { title: 'Dream State', artist: 'Daybreak Ritual', album: 'Dawn Arc', duration: 232, cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80', audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
    { title: 'Lunar Kite', artist: 'Cinder Avenue', album: 'Threshold', duration: 188, cover: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80', audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
    { title: 'Hollow Glow', artist: 'Harbor Echo', album: 'Faded Noon', duration: 241, cover: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=900&q=80', audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' }
  ];

  return albumSeeds.map((track, index) => ({
    id: `fallback-${index + 1}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    cover: track.cover,
    audioUrl: track.audioUrl,
    source: 'fallback',
    status: 'ready'
  }));
}

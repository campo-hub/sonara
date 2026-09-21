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

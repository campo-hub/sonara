const CATALOG_CACHE_KEY = 'sonara.web.catalog.v2';
const LEGACY_CATALOG_CACHE_KEYS = ['sonara.web.catalog.v1'];
const fallbackMemoryStore = new Map();

const getStorage = () => {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  return {
    getItem: (key) => fallbackMemoryStore.has(key) ? fallbackMemoryStore.get(key) : null,
    setItem: (key, value) => { fallbackMemoryStore.set(key, value); },
    removeItem: (key) => { fallbackMemoryStore.delete(key); }
  };
};

export const isSampleCatalog = (songs) => Array.isArray(songs) && songs.some((song) => String(song?.id || '').startsWith('seed-'));

export const getCatalogCacheKey = () => CATALOG_CACHE_KEY;

export const getCachedCatalog = () => {
  try {
    const storage = getStorage();
    LEGACY_CATALOG_CACHE_KEYS.forEach((key) => storage.removeItem(key));
    const raw = storage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || isSampleCatalog(parsed)) {
      storage.removeItem(CATALOG_CACHE_KEY);
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
};

export const saveCachedCatalog = (songs) => {
  try {
    if (!Array.isArray(songs) || !songs.length || isSampleCatalog(songs)) return;
    getStorage().setItem(CATALOG_CACHE_KEY, JSON.stringify(songs));
  } catch {
    // storage unavailable, ignore gracefully
  }
};

export const clearCachedCatalog = () => {
  try {
    const storage = getStorage();
    storage.removeItem(CATALOG_CACHE_KEY);
    LEGACY_CATALOG_CACHE_KEYS.forEach((key) => storage.removeItem(key));
  } catch {
    // storage unavailable, ignore gracefully
  }
};

export const pickRandomFeaturedTrack = ({ catalog = [], recentIds = [], lastFeaturedIds = [] } = {}) => {
  const playable = Array.isArray(catalog) ? catalog.filter((track) => track && track.id && track.audioUrl) : [];
  if (!playable.length) return null;

  const blocked = new Set([...recentIds, ...lastFeaturedIds]);
  const eligible = playable.filter((track) => !blocked.has(track.id));
  const finalOptions = eligible.length ? eligible : playable;
  if (!finalOptions.length) return null;

  return finalOptions[Math.floor(Math.random() * finalOptions.length)];
};

export const normalizePlaylistShape = (playlist, fallbackName = 'Untitled playlist') => {
  if (!playlist || typeof playlist !== 'object') {
    return { id: '', name: fallbackName, description: '', trackIds: [], tracks: [] };
  }

  const trackIds = Array.isArray(playlist.trackIds)
    ? playlist.trackIds.filter((id) => id !== null && id !== undefined && String(id).trim() !== '')
    : [];
  const normalized = {
    ...playlist,
    id: String(playlist.id || playlist._id || '').trim(),
    name: String(playlist.name || fallbackName).trim() || fallbackName,
    description: String(playlist.description || '').trim(),
    trackIds: [...new Set(trackIds.map((id) => String(id)))],
    tracks: Array.isArray(playlist.tracks) ? playlist.tracks.filter(Boolean) : []
  };

  return normalized;
};

export const mergePlaylistList = (playlists = []) => {
  const unique = new Map();
  for (const playlist of Array.isArray(playlists) ? playlists : []) {
    const normalized = normalizePlaylistShape(playlist);
    if (!normalized.id) continue;
    const existing = unique.get(normalized.id);
    if (existing) {
      const mergedTrackIds = [...new Set([...(existing.trackIds || []), ...(normalized.trackIds || [])])];
      unique.set(normalized.id, {
        ...existing,
        ...normalized,
        trackIds: mergedTrackIds,
        tracks: existing.tracks?.length ? existing.tracks : normalized.tracks || []
      });
      continue;
    }
    unique.set(normalized.id, normalized);
  }
  return [...unique.values()];
};

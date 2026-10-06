const CATALOG_CACHE_KEY = 'sonara.web.catalog.v2';
const LEGACY_CATALOG_CACHE_KEYS = ['sonara.web.catalog.v1'];
const FEATURED_HISTORY_KEY = 'sonara.web.featured.history.v2';
const PLAY_HISTORY_KEY = 'sonara.web.play.history.v1';
const MAX_PLAY_HISTORY = 7;
const RECOMMENDATIONS_CACHE_KEY = 'sonara.web.recommendations.v1';
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

const readStoredList = (key) => {
  try {
    const raw = getStorage().getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeStoredList = (key, value) => {
  try {
    getStorage().setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable, keep the in-memory state authoritative
  }
};

export const loadFeaturedHistory = () => readStoredList(FEATURED_HISTORY_KEY)
  .filter((id) => typeof id === 'string')
  .slice(-10);

export const saveFeaturedHistory = (history) => {
  const next = Array.isArray(history) ? history.filter((id) => typeof id === 'string').slice(-10) : [];
  writeStoredList(FEATURED_HISTORY_KEY, next);
  return next;
};

export const loadPlayHistory = () => readStoredList(PLAY_HISTORY_KEY)
  .filter((entry) => entry && typeof entry.trackId === 'string' && Number.isFinite(entry.at))
  .slice(0, MAX_PLAY_HISTORY);

export const savePlayHistory = (history) => {
  const next = Array.isArray(history) ? history.slice(0, MAX_PLAY_HISTORY) : [];
  writeStoredList(PLAY_HISTORY_KEY, next);
  return next;
};

export const loadCachedRecommendations = () => {
  try {
    const raw = getStorage().getItem(RECOMMENDATIONS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const saveCachedRecommendations = (value) => {
  if (!value || typeof value !== 'object') return;
  writeStoredList(RECOMMENDATIONS_CACHE_KEY, value);
};

export const updatePlayHistory = ({ history = [], trackId, at = Date.now(), maxEntries = MAX_PLAY_HISTORY } = {}) => {
  if (!trackId) return Array.isArray(history) ? history : [];
  const next = [
    { trackId: String(trackId), at: Number.isFinite(at) ? at : Date.now() },
    ...(Array.isArray(history) ? history : []).filter((entry) => entry?.trackId !== String(trackId))
  ];
  return next.slice(0, Math.max(1, maxEntries));
};

export const qualifiesForPlayHistory = ({ listenedSeconds = 0, currentTime = 0, duration = 0 } = {}) => (
  listenedSeconds >= 10 || (duration > 0 && duration < 20 && currentTime >= duration - 0.25)
);

const hashString = (value = '') => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const pickRandomFeaturedTrack = ({ catalog = [], recentIds = [], lastFeaturedIds = [], recentlyPlayedIds = [] } = {}) => {
  const playable = Array.isArray(catalog) ? catalog.filter((track) => track && track.id && track.audioUrl) : [];
  if (!playable.length) return null;

  const history = [...recentIds, ...lastFeaturedIds].filter(Boolean);
  const exclusionCount = Math.min(10, Math.floor(playable.length / 2));
  const blocked = new Set(history.slice(-Math.max(exclusionCount, history.length)));
  const preferred = playable.filter((track) => !blocked.has(track.id) && !recentlyPlayedIds.includes(track.id));
  const eligible = playable.filter((track) => !blocked.has(track.id));
  const fallback = playable.filter((track) => track.id !== history.at(-1));
  const finalOptions = (preferred.length ? preferred : eligible.length ? eligible : fallback.length ? fallback : playable);
  if (!finalOptions.length) return null;

  return finalOptions[Math.floor(Math.random() * finalOptions.length)];
};

export const buildDailyMix = ({ catalog = [], userId = 'guest', dateKey = new Date().toISOString().slice(0, 10), limit = 5 } = {}) => {
  const tracks = Array.isArray(catalog) ? catalog.filter((track) => track && track.id && track.audioUrl) : [];
  if (!tracks.length) return [];

  const normalizedLimit = Math.max(1, Math.min(limit || tracks.length, tracks.length));
  const seed = `${dateKey}:${String(userId || 'guest')}`;
  const scored = tracks.map((track) => ({
    ...track,
    score: hashString(`${seed}:${track.id}:${track.title || ''}:${track.artist || ''}`)
  }));

  scored.sort((left, right) => left.score - right.score);
  return scored.slice(0, normalizedLimit);
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

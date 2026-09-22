const CATALOG_CACHE_KEY = 'sonara.web.catalog.v2';
const LEGACY_CATALOG_CACHE_KEYS = ['sonara.web.catalog.v1'];

export const isSampleCatalog = (songs) => Array.isArray(songs) && songs.some((song) => String(song?.id || '').startsWith('seed-'));

export const getCatalogCacheKey = () => CATALOG_CACHE_KEY;

export const getCachedCatalog = () => {
  try {
    LEGACY_CATALOG_CACHE_KEYS.forEach((key) => window.localStorage.removeItem(key));
    const raw = window.localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || isSampleCatalog(parsed)) {
      window.localStorage.removeItem(CATALOG_CACHE_KEY);
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
    window.localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(songs));
  } catch {
    // storage unavailable, ignore gracefully
  }
};

export const clearCachedCatalog = () => {
  try {
    window.localStorage.removeItem(CATALOG_CACHE_KEY);
    LEGACY_CATALOG_CACHE_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // storage unavailable, ignore gracefully
  }
};

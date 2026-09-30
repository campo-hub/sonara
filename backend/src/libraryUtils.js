export function buildEmptyLibraryPayload() {
  return {
    preferences: {
      liked: []
    },
    dailyMixes: [],
    mixHistory: []
  };
}

function normalizeMixEntries(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: String(item.id || item._id || `mix-${Math.random().toString(36).slice(2, 10)}`),
      name: String(item.name || 'Daily mix').trim() || 'Daily mix',
      dateKey: String(item.dateKey || '').trim(),
      deviceId: String(item.deviceId || 'web').trim() || 'web',
      trackIds: Array.isArray(item.trackIds) ? [...new Set(item.trackIds.map((trackId) => String(trackId)))] : [],
      tracks: Array.isArray(item.tracks) ? item.tracks.filter(Boolean) : [],
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
    }));
}

export function normalizeLibraryData(data = {}) {
  const incoming = data && typeof data === 'object' ? data : {};
  const preferencesInput = incoming.preferences && typeof incoming.preferences === 'object' ? incoming.preferences : {};
  const mergedPreferences = {
    ...preferencesInput,
    ...incoming,
    liked: Array.isArray(incoming.liked) ? incoming.liked : Array.isArray(preferencesInput.liked) ? preferencesInput.liked : []
  };

  delete mergedPreferences.preferences;
  delete mergedPreferences.playlists;
  delete mergedPreferences.dailyMixes;
  delete mergedPreferences.mixHistory;

  return {
    preferences: mergedPreferences,
    playlists: [],
    dailyMixes: normalizeMixEntries(incoming.dailyMixes || incoming.savedMixes || preferencesInput.dailyMixes),
    mixHistory: normalizeMixEntries(incoming.mixHistory || preferencesInput.mixHistory)
  };
}

export function mergeLibraryData(existing = {}, incoming = {}) {
  const previous = normalizeLibraryData(existing);
  const nextIncoming = normalizeLibraryData(incoming);
  const nextPreferences = {
    ...previous.preferences,
    ...nextIncoming.preferences,
    liked: Array.isArray(nextIncoming.preferences.liked) ? nextIncoming.preferences.liked : previous.preferences.liked || []
  };

  const dailyMixes = nextIncoming.dailyMixes.length ? nextIncoming.dailyMixes : previous.dailyMixes || [];
  const mixHistory = nextIncoming.mixHistory.length ? nextIncoming.mixHistory : previous.mixHistory || [];

  return {
    preferences: nextPreferences,
    playlists: [],
    dailyMixes,
    mixHistory
  };
}


export function buildEmptyLibraryPayload() {
  return {
    preferences: {
      liked: []
    }
  };
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

  return {
    preferences: mergedPreferences,
    playlists: []
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

  return {
    preferences: nextPreferences,
    playlists: []
  };
}


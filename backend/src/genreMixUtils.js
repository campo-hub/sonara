import { normalizeGenre } from './genres.js';

const hashString = (value = '') => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const playableTracks = (catalog = []) => Array.isArray(catalog)
  ? catalog.filter((track) => track && track.id && (track.audioUrl || track.audio_url || track.src))
    .map((track) => ({ ...track, id: String(track.id), artist: String(track.artist || 'Unknown artist'), album: String(track.album || '') }))
  : [];

export const escapeCsvCell = (value) => {
  const stringValue = value == null ? '' : String(value);
  const escaped = stringValue.replace(/"/g, '""');
  if (/[",\n\r]/.test(stringValue) || /^[=+\-@]/.test(stringValue)) {
    return `"${escaped}"`;
  }
  return escaped;
};

export const exportCatalogCsv = (tracks = [], { onlyMissingGenre = false, batchId = '' } = {}) => {
  const rows = Array.isArray(tracks) ? tracks : [];
  const headers = ['id', 'title', 'artist', 'album', 'duration', 'cover', 'audioUrl', 'objectKey', 'source', 'createdAt', 'genre', 'subgenres', 'mood', 'energy', 'language', 'genreSource', 'genreConfidence', 'genreUpdatedAt'];
  const exportHeaders = batchId ? ['batchId', ...headers] : headers;
  const values = rows.filter((track) => !onlyMissingGenre || !normalizeGenre(track?.genre));

  const matrix = [exportHeaders, ...values.map((track) => exportHeaders.map((key) => {
    if (key === 'batchId') return batchId;
    if (key === 'subgenres') {
      const subgenres = Array.isArray(track?.subgenres) ? track.subgenres : [];
      return subgenres.join('|');
    }
    if (key === 'duration') return Number(track?.duration) || 0;
    if (key === 'genreConfidence') return Number(track?.genreConfidence) || 0;
    return track?.[key] ?? '';
  }))];

  return `\uFEFF${matrix.map((row) => row.map(escapeCsvCell).join(',')).join('\n')}`;
};

export const buildGenreAwareDailyMix = ({ catalog = [], userId = 'guest', dateKey = new Date().toISOString().slice(0, 10), limit = 5 } = {}) => {
  const tracks = playableTracks(catalog);
  if (!tracks.length) return [];

  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, tracks.length));
  const seed = `${dateKey}:${String(userId || 'guest')}`;
  const grouped = new Map();

  for (const track of tracks) {
    const genre = normalizeGenre(track.genre) || 'Unsorted';
    const bucket = grouped.get(genre) || [];
    bucket.push(track);
    grouped.set(genre, bucket);
  }

  const preferredGenres = [...grouped.entries()].sort((left, right) => {
    if (right[1].length !== left[1].length) return right[1].length - left[1].length;
    return left[0].localeCompare(right[0]);
  });

  const selected = [];
  const seen = new Set();

  for (const [genre, bucket] of preferredGenres) {
    const ranked = [...bucket]
      .map((track) => ({ ...track, _rank: hashString(`${seed}:${genre}:${track.id}`) }))
      .sort((left, right) => left._rank - right._rank);

    for (const track of ranked) {
      if (seen.has(track.id)) continue;
      selected.push({ ...track, genre });
      seen.add(track.id);
      if (selected.length >= safeLimit) break;
    }

    if (selected.length >= safeLimit) break;
  }

  if (selected.length < safeLimit) {
    const fallback = [...tracks]
      .map((track) => ({ ...track, _rank: hashString(`${seed}:${track.id}`) }))
      .sort((left, right) => left._rank - right._rank);

    for (const track of fallback) {
      if (seen.has(track.id)) continue;
      selected.push({ ...track, genre: normalizeGenre(track.genre) || 'Unsorted' });
      if (selected.length >= safeLimit) break;
    }
  }

  return selected.slice(0, safeLimit).map(({ _rank, genre, ...track }) => ({ ...track, genre }));
};

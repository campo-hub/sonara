import { buildGenreAwareDailyMix } from './genreMixUtils.js';
import { normalizeGenre } from './genres.js';

const FLAVORS = ['mixed', 'artist-focus', 'album-trail', 'new-arrivals', 'wildcard'];
const NAME_WORDS = [
  ['Velvet', 'Hours'], ['Slow', 'Sunrise Static'], ['Afterglow', 'Letters'], ['Soft', 'Circuit'],
  ['Night', 'Bloom'], ['Golden', 'Side A'], ['Low Tide', 'Radio'], ['Blue', 'Room'],
  ['Quiet', 'Voltage'], ['Open', 'Window'], ['Warm', 'Static'], ['Silver', 'Current']
];

const hashString = (value = '') => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const playableTracks = (catalog) => (Array.isArray(catalog) ? catalog : [])
  .filter((track) => track && track.id && (track.audioUrl || track.audio_url || track.src))
  .map((track) => ({ ...track, id: String(track.id), artist: String(track.artist || 'Unknown artist'), album: String(track.album || '') }));

export const getRecommendationSizing = (trackCount) => {
  const count = Math.max(0, Number(trackCount) || 0);
  if (!count) return { count: 0, size: 0 };
  if (count < 10) return { count: 1, size: count };
  const mixCount = Math.min(10, Math.floor(count / 10));
  return { count: mixCount, size: Math.min(30, Math.floor(count / mixCount)) };
};

const orderMix = (tracks, flavor, limit, seed) => {
  const base = buildGenreAwareDailyMix({ catalog: tracks, userId: `${seed}:${flavor}`, dateKey: seed, limit });
  const remaining = [...tracks].filter((track) => !base.some((picked) => picked.id === track.id));
  const candidates = [...base, ...remaining];
  const result = [];
  const artistCounts = new Map();

  while (candidates.length && result.length < limit) {
    const previousArtist = result.at(-1)?.artist;
    const available = candidates.filter((track) => String(track.artist || 'Unknown artist') !== previousArtist);
    const pool = available.length ? available : candidates;
    const choice = pool[0];
    candidates.splice(candidates.indexOf(choice), 1);
    const artist = String(choice.artist || 'Unknown artist');
    const count = artistCounts.get(artist) || 0;
    if (flavor === 'mixed' && count >= 4 && available.length) continue;
    result.push(choice);
    artistCounts.set(artist, count + 1);
  }

  return result.slice(0, limit);
};

const chooseName = (index, flavor, tracks, usedNames, seed) => {
  const artist = tracks[0]?.artist;
  const genres = [...new Set(tracks.map((track) => normalizeGenre(track.genre)).filter(Boolean))];
  const genreName = genres.length === 1 ? `${genres[0]} Mix` : '';
  if (genreName && !usedNames.has(genreName)) {
    usedNames.add(genreName);
    return genreName;
  }
  const candidates = flavor === 'artist-focus' && artist
    ? [`Deep in ${artist}`, `Around ${artist}`, `${artist} at Dusk`]
    : NAME_WORDS.map(([first, second]) => `${first} ${second}`);
  const ranked = [...candidates].sort((left, right) => hashString(`${seed}:${left}`) - hashString(`${seed}:${right}`));
  const name = ranked.find((candidate) => !usedNames.has(candidate)) || `Daily Mix ${String(index + 1).padStart(2, '0')}`;
  usedNames.add(name);
  return name;
};

export const generateUniversalDailyMixSnapshot = ({ catalog = [], dateKey, limit = 8, minimumGenreTracks = 5 } = {}) => {
  const tracks = playableTracks(catalog);
  if (!tracks.length) return { dateKey, mixes: [] };

  const genreGroups = new Map();
  for (const track of tracks) {
    const genre = normalizeGenre(track.genre);
    if (!genre) continue;
    const group = genreGroups.get(genre) || [];
    group.push(track);
    genreGroups.set(genre, group);
  }

  const genres = [...genreGroups.entries()]
    .filter(([, group]) => group.length >= Math.max(1, minimumGenreTracks))
    .sort((left, right) => hashString(`${dateKey}:genre:${left[0]}`) - hashString(`${dateKey}:genre:${right[0]}`))
    .slice(0, Math.max(0, Math.min(6, (Number(limit) || 8) - 2)));

  const buildMix = (id, name, flavor, items) => ({
    id,
    name,
    flavor,
    subtitle: [...new Set(items.map((track) => track.artist).filter(Boolean))].slice(0, 3).join(' · '),
    trackIds: items.map((track) => track.id)
  });

  const mixes = genres.map(([genre, group]) => {
    const selected = [...group]
      .sort((left, right) => hashString(`${dateKey}:${genre}:${left.id}`) - hashString(`${dateKey}:${genre}:${right.id}`))
      .slice(0, Math.min(30, group.length));
    const slug = genre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return buildMix(`genre-${dateKey}-${slug}`, `${genre} Mix`, 'genre', selected);
  });

  const newest = [...tracks].sort((left, right) => Date.parse(right.createdAt || right.addedAt || 0) - Date.parse(left.createdAt || left.addedAt || 0));
  const deep = [...tracks].sort((left, right) => (Number(left.playCount) || 0) - (Number(right.playCount) || 0) || hashString(`${dateKey}:deep:${left.id}`) - hashString(`${dateKey}:deep:${right.id}`));
  mixes.push(buildMix(`new-arrivals-${dateKey}`, 'New Arrivals', 'new-arrivals', newest.slice(0, Math.min(30, newest.length))));
  mixes.push(buildMix(`deep-cuts-${dateKey}`, 'Deep Cuts', 'deep-cuts', deep.slice(0, Math.min(30, deep.length))));

  if (!genres.length) {
    mixes.unshift(buildMix(`daily-${dateKey}`, 'Daily Mix', 'daily', [...tracks].sort((left, right) => hashString(`${dateKey}:${left.id}`) - hashString(`${dateKey}:${right.id}`)).slice(0, Math.min(30, tracks.length))));
  }

  return { dateKey, mixes };
};

export const generateDailyMixSnapshot = ({ catalog = [], dateKey, seen = [], recentNames = [] } = {}) => {
  const tracks = playableTracks(catalog);
  const sizing = getRecommendationSizing(tracks.length);
  if (!sizing.count) return { mixes: [], seen: [...seen], names: [...recentNames] };

  const usedToday = new Set();
  const seenSet = new Set((Array.isArray(seen) ? seen : []).map(String));
  const ranked = [...tracks].sort((left, right) => hashString(`${dateKey}:${left.id}`) - hashString(`${dateKey}:${right.id}`));
  const unseen = ranked.filter((track) => !seenSet.has(track.id));
  const available = [...unseen, ...ranked.filter((track) => !unseen.includes(track))];
  const required = sizing.count * sizing.size;
  const selected = available.filter((track) => !usedToday.has(track.id)).slice(0, required);
  const usedIds = new Set(selected.map((track) => track.id));
  const usedNames = new Set(Array.isArray(recentNames) ? recentNames : []);
  const mixes = [];

  for (let index = 0; index < sizing.count; index += 1) {
    const flavor = FLAVORS[index % FLAVORS.length];
    const chunk = selected.slice(index * sizing.size, (index + 1) * sizing.size);
    const ordered = orderMix(chunk, flavor, sizing.size, `${dateKey}:${index}`);
    mixes.push({
      id: `recommended-${dateKey}-${String(index + 1).padStart(2, '0')}`,
      name: chooseName(index, flavor, ordered, usedNames, dateKey),
      flavor,
      trackIds: ordered.map((track) => track.id)
    });
  }

  const nextSeen = [...new Set([...seenSet, ...usedIds])];
  return { mixes, seen: nextSeen, names: [...usedNames].slice(-30) };
};

export const getPlayableTracks = playableTracks;
import { buildGenreAwareDailyMix } from './genreMixUtils.js';

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
  const candidates = flavor === 'artist-focus' && artist
    ? [`Deep in ${artist}`, `Around ${artist}`, `${artist} at Dusk`]
    : NAME_WORDS.map(([first, second]) => `${first} ${second}`);
  const ranked = [...candidates].sort((left, right) => hashString(`${seed}:${left}`) - hashString(`${seed}:${right}`));
  const name = ranked.find((candidate) => !usedNames.has(candidate)) || `Sonara Set ${String(index + 1).padStart(2, '0')}`;
  usedNames.add(name);
  return name;
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
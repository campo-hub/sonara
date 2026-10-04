export const GENRE_VOCABULARY = [
  'Gospel',
  'Worship',
  'Afrobeats',
  'Amapiano',
  'Hip-Hop',
  'R&B',
  'Pop',
  'Rock',
  'Reggae',
  'Dancehall',
  'Jazz',
  'Classical',
  'Electronic',
  'Lo-Fi',
  'Country',
  'Latin',
  'Soul',
  'Blues',
  'Traditional/Folk',
  'Kenyan Gospel',
  'Bongo Flava',
  'Genge',
  'Benga',
  'Other'
];

const NORMALIZED_GENRE_MAP = new Map([
  ['gospel', 'Gospel'],
  ['christian', 'Gospel'],
  ['worship', 'Worship'],
  ['afrobeats', 'Afrobeats'],
  ['amapiano', 'Amapiano'],
  ['hip hop', 'Hip-Hop'],
  ['hip-hop', 'Hip-Hop'],
  ['hiphop', 'Hip-Hop'],
  ['rap', 'Hip-Hop'],
  ['r&b', 'R&B'],
  ['r and b', 'R&B'],
  ['rnb', 'R&B'],
  ['rb', 'R&B'],
  ['soul', 'Soul'],
  ['reggae', 'Reggae'],
  ['dancehall', 'Dancehall'],
  ['jazz', 'Jazz'],
  ['classical', 'Classical'],
  ['electronic', 'Electronic'],
  ['lo-fi', 'Lo-Fi'],
  ['lofi', 'Lo-Fi'],
  ['country', 'Country'],
  ['latin', 'Latin'],
  ['blues', 'Blues'],
  ['traditional/folk', 'Traditional/Folk'],
  ['traditional folk', 'Traditional/Folk'],
  ['folk', 'Traditional/Folk'],
  ['kenyan gospel', 'Kenyan Gospel'],
  ['bongo flava', 'Bongo Flava'],
  ['genge', 'Genge'],
  ['benga', 'Benga'],
  ['other', 'Other']
]);

const canonicalSet = new Set(GENRE_VOCABULARY);

export const normalizeGenre = (input) => {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/[_/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const mapped = NORMALIZED_GENRE_MAP.get(normalized) || NORMALIZED_GENRE_MAP.get(normalized.replace(/\s+/g, ' '));
  if (mapped) return mapped;
  if (canonicalSet.has(raw)) return raw;
  if (canonicalSet.has(raw.replace(/\s+/g, ' '))) return raw.replace(/\s+/g, ' ');
  return null;
};

export const getAllowedGenres = () => [...GENRE_VOCABULARY];

export const isGenreAllowed = (value) => Boolean(normalizeGenre(value));

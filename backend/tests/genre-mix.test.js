import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGenre, getAllowedGenres } from '../src/genres.js';
import { buildGenreAwareDailyMix, buildGenrePlaylists, exportCatalogCsv } from '../src/genreMixUtils.js';

const makeTrack = (id, title, artist, genre) => ({
  id,
  title,
  artist,
  genre,
  audioUrl: `https://example.com/${id}.mp3`
});

test('normalizeGenre accepts canonical and alias values', () => {
  assert.equal(normalizeGenre('hip hop'), 'Hip-Hop');
  assert.equal(normalizeGenre('r&b'), 'R&B');
  assert.equal(normalizeGenre('Kenyan gospel'), 'Kenyan Gospel');
  assert.ok(getAllowedGenres().includes('Hip-Hop'));
});

test('CSV export writes a UTF-8 BOM and preserves formula-safe values', () => {
  const csv = exportCatalogCsv([
    makeTrack('1', 'Song', 'Artist', 'Hip-Hop'),
    { id: '2', title: '=cmd', artist: '+1', genre: 'Pop' }
  ]);

  assert.match(csv, /^\uFEFF/);
  assert.match(csv, /"=cmd"/);
  assert.match(csv, /"\+1"/);
  assert.match(csv, /Hip-Hop/);
});

test('genre-aware daily mix prefers recognized genres but stays deterministic', () => {
  const tracks = [
    makeTrack('1', 'A', 'Artist A', 'Pop'),
    makeTrack('2', 'B', 'Artist B', 'Hip-Hop'),
    makeTrack('3', 'C', 'Artist C', 'Hip-Hop'),
    makeTrack('4', 'D', 'Artist D', 'Gospel'),
    makeTrack('5', 'E', 'Artist E', 'Pop')
  ];

  const first = buildGenreAwareDailyMix({ catalog: tracks, userId: 'user-1', dateKey: '2025-01-01', limit: 3 });
  const second = buildGenreAwareDailyMix({ catalog: tracks, userId: 'user-1', dateKey: '2025-01-01', limit: 3 });
  assert.equal(first.length, 3);
  assert.deepEqual(first.map((track) => track.id), second.map((track) => track.id));
  assert.ok(first.some((track) => normalizeGenre(track.genre) === 'Hip-Hop'));
});

test('genre playlists group playable tracks, omit untagged and empty genres, and include cover samples', () => {
  const playlists = buildGenrePlaylists([
    { ...makeTrack('1', 'A', 'Artist A', 'Gospel'), cover: '/cover-a.jpg' },
    { ...makeTrack('2', 'B', 'Artist B', 'gospel'), cover: '/cover-b.jpg' },
    { ...makeTrack('3', 'C', 'Artist C', 'Hip-Hop'), audioUrl: '' },
    { id: '4', title: 'No tag', audioUrl: '/4.mp3' }
  ]);

  assert.deepEqual(playlists.map((playlist) => playlist.genre), ['Gospel']);
  assert.equal(playlists[0].trackCount, 2);
  assert.deepEqual(playlists[0].trackIds, ['1', '2']);
  assert.deepEqual(playlists[0].covers, ['/cover-a.jpg', '/cover-b.jpg']);
});

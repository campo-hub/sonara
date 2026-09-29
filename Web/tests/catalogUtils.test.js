import test from 'node:test';
import assert from 'node:assert/strict';

import { isSampleCatalog, getCachedCatalog, saveCachedCatalog, clearCachedCatalog, pickRandomFeaturedTrack, normalizePlaylistShape, mergePlaylistList } from '../src/catalogUtils.js';

test('sample seeds are rejected as stale cached catalog data', () => {
  const songs = [{ id: 'seed-night-drive', title: 'Night Drive' }];
  assert.equal(isSampleCatalog(songs), true);
});

test('empty catalog payloads are not treated as valid cached data', () => {
  clearCachedCatalog();
  const cached = getCachedCatalog();
  assert.deepEqual(cached, []);
});

test('real catalog data is saved and restored from the cache', () => {
  clearCachedCatalog();
  const songs = [{ id: 'real-1', title: 'Song 1', duration: 120 }];
  saveCachedCatalog(songs);
  assert.deepEqual(getCachedCatalog(), songs);
  clearCachedCatalog();
});

test('pickRandomFeaturedTrack excludes recently featured songs and prefers playable catalog entries', () => {
  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    const catalog = [
      { id: 'a', audioUrl: 'https://example.com/a.mp3' },
      { id: 'b', audioUrl: 'https://example.com/b.mp3' },
      { id: 'c', audioUrl: 'https://example.com/c.mp3' }
    ];

    const chosen = pickRandomFeaturedTrack({ catalog, recentIds: ['a'], lastFeaturedIds: ['b'] });
    assert.equal(chosen.id, 'c');

    const single = pickRandomFeaturedTrack({ catalog: [{ id: 'x', audioUrl: 'https://example.com/x.mp3' }], recentIds: ['x'], lastFeaturedIds: ['x'] });
    assert.equal(single.id, 'x');
  } finally {
    Math.random = originalRandom;
  }
});

test('playlist shapes are normalized and duplicate entries are merged by id', () => {
  const original = [
    { id: 'p1', name: ' Road Trip ', description: 'Sunset drive', trackIds: ['a', 'b', 'a'], tracks: [{ id: 'a' }] },
    { id: 'p1', name: 'Road Trip', trackIds: ['a', 'c'] },
    { id: 'p2', name: 'Morning', trackIds: [] }
  ];

  const normalized = mergePlaylistList(original).map((playlist) => normalizePlaylistShape(playlist));
  assert.deepEqual(normalized.map((playlist) => playlist.id), ['p1', 'p2']);
  assert.equal(normalized[0].name, 'Road Trip');
  assert.deepEqual(normalized[0].trackIds, ['a', 'b', 'c']);
  assert.deepEqual(normalized[1].trackIds, []);
});

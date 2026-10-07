import test from 'node:test';
import assert from 'node:assert/strict';

import { isSampleCatalog, getCachedCatalog, saveCachedCatalog, clearCachedCatalog, loadCachedSavedMixes, saveCachedSavedMixes, pickRandomFeaturedTrack, buildDailyMix, normalizePlaylistShape, mergePlaylistList, qualifiesForPlayHistory, updatePlayHistory } from '../src/catalogUtils.js';

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

test('saved mixes are cached per account for offline fallback', () => {
  const mixes = [{ id: 'saved-mix-1', trackIds: ['track-1'] }];
  saveCachedSavedMixes('account-one', mixes);

  assert.deepEqual(loadCachedSavedMixes('account-one'), mixes);
  assert.deepEqual(loadCachedSavedMixes('account-two'), []);
  assert.deepEqual(loadCachedSavedMixes(''), []);
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

test('featured picker handles small libraries and skips unplayable tracks', () => {
  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    const catalog = [
      { id: 'first', audioUrl: 'https://example.com/first.mp3' },
      { id: 'silent', audioUrl: '' },
      { id: 'second', audioUrl: 'https://example.com/second.mp3' }
    ];
    assert.equal(pickRandomFeaturedTrack({ catalog, recentIds: ['first'] }).id, 'second');
    assert.equal(pickRandomFeaturedTrack({ catalog: [{ id: 'only', audioUrl: 'x' }], recentIds: ['only'] }).id, 'only');
    assert.equal(pickRandomFeaturedTrack({ catalog: [{ id: 'silent' }] }), null);
  } finally {
    Math.random = originalRandom;
  }
});

test('play history requires ten seconds or the end of a short track', () => {
  assert.equal(qualifiesForPlayHistory({ listenedSeconds: 9.9, currentTime: 9.9, duration: 240 }), false);
  assert.equal(qualifiesForPlayHistory({ listenedSeconds: 10, currentTime: 10, duration: 240 }), true);
  assert.equal(qualifiesForPlayHistory({ listenedSeconds: 2, currentTime: 4.9, duration: 5 }), true);
  assert.equal(qualifiesForPlayHistory({ listenedSeconds: 2, currentTime: 4, duration: 5 }), false);
});

test('play history moves replays to the top, deduplicates, and caps at seven', () => {
  const initial = Array.from({ length: 7 }, (_, index) => ({ trackId: `track-${index}`, at: index }));
  const replayed = updatePlayHistory({ history: initial, trackId: 'track-25', at: 100 });
  assert.equal(replayed[0].trackId, 'track-25');
  assert.equal(replayed.filter((entry) => entry.trackId === 'track-25').length, 1);
  assert.equal(replayed.length, 7);

  const added = updatePlayHistory({ history: replayed, trackId: 'new-track', at: 101 });
  assert.equal(added.length, 7);
  assert.equal(added[0].trackId, 'new-track');
  assert.equal(added.some((entry) => entry.trackId === 'track-6'), false);
});

test('daily mix generation is deterministic per day and user', () => {
  const catalog = [
    { id: 'a', audioUrl: 'https://example.com/a.mp3', title: 'A' },
    { id: 'b', audioUrl: 'https://example.com/b.mp3', title: 'B' },
    { id: 'c', audioUrl: 'https://example.com/c.mp3', title: 'C' },
    { id: 'd', audioUrl: 'https://example.com/d.mp3', title: 'D' },
    { id: 'e', audioUrl: 'https://example.com/e.mp3', title: 'E' }
  ];

  const first = buildDailyMix({ catalog, userId: 'listener-1', dateKey: '2026-09-30', limit: 3 });
  const second = buildDailyMix({ catalog, userId: 'listener-1', dateKey: '2026-09-30', limit: 3 });
  const other = buildDailyMix({ catalog, userId: 'listener-2', dateKey: '2026-09-30', limit: 3 });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first.map((track) => track.id), other.map((track) => track.id));
  assert.equal(first.length, 3);
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

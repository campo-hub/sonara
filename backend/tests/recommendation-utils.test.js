import test from 'node:test';
import assert from 'node:assert/strict';

import { generateDailyMixSnapshot, getPlayableTracks, getRecommendationSizing } from '../src/recommendationUtils.js';

const catalogOf = (count) => Array.from({ length: count }, (_, index) => ({
  id: `track-${index}`,
  title: `Track ${index}`,
  artist: `Artist ${index % 17}`,
  album: `Album ${index % 9}`,
  audioUrl: `https://example.com/${index}.mp3`
}));

test('recommendation sizing follows the requested degradation rules', () => {
  const expected = new Map([
    [0, [0, 0]], [1, [1, 1]], [9, [1, 9]], [10, [1, 10]], [29, [2, 14]],
    [30, [3, 10]], [99, [9, 11]], [100, [10, 10]], [299, [10, 29]], [300, [10, 30]], [301, [10, 30]], [1000, [10, 30]]
  ]);
  for (const [count, [mixCount, size]] of expected) {
    assert.deepEqual(getRecommendationSizing(count), { count: mixCount, size });
  }
});

test('a daily snapshot has no duplicate track ids and ignores unplayable catalog rows', () => {
  const catalog = catalogOf(100);
  catalog.push({ id: 'silent', title: 'Silent', audioUrl: '' });
  const snapshot = generateDailyMixSnapshot({ catalog, dateKey: '2026-09-30' });
  const ids = snapshot.mixes.flatMap((mix) => mix.trackIds);
  assert.equal(snapshot.mixes.length, 10);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.every((id) => id !== 'silent'), true);
  assert.equal(snapshot.mixes.every((mix) => new Set(mix.trackIds).size === mix.trackIds.length), true);
  assert.equal(new Set(snapshot.mixes.map((mix) => mix.name)).size, snapshot.mixes.length);
});

test('the same owner-day inputs generate the same set and successive days cover the pool', () => {
  const catalog = catalogOf(300);
  const first = generateDailyMixSnapshot({ catalog, dateKey: '2026-09-30' });
  const repeat = generateDailyMixSnapshot({ catalog, dateKey: '2026-09-30' });
  assert.deepEqual(first.mixes, repeat.mixes);

  const second = generateDailyMixSnapshot({ catalog, dateKey: '2026-10-01', seen: first.seen });
  const allIds = [...first.mixes, ...second.mixes].flatMap((mix) => mix.trackIds);
  assert.equal(new Set(allIds).size, 300);
});

test('artist ordering avoids back-to-back artists when alternatives exist', () => {
  const catalog = catalogOf(100);
  const snapshot = generateDailyMixSnapshot({ catalog, dateKey: '2026-09-30' });
  for (const mix of snapshot.mixes) {
    const artists = mix.trackIds.map((id) => catalog.find((track) => track.id === id).artist);
    for (let index = 1; index < artists.length; index += 1) {
      assert.notEqual(artists[index], artists[index - 1]);
    }
  }
});

test('playable track helper normalizes ids and removes unplayable rows', () => {
  assert.deepEqual(getPlayableTracks([{ id: 1, audioUrl: 'x' }, { id: 2 }]).map((track) => track.id), ['1']);
});
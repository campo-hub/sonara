import test from 'node:test';
import assert from 'node:assert/strict';

import { generateDailyMixSnapshot, generateUniversalDailyMixSnapshot, getPlayableTracks, getRecommendationSizing } from '../src/recommendationUtils.js';

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

test('universal daily mixes are deterministic and use genre names for everyone', () => {
  const catalog = [
    ...Array.from({ length: 6 }, (_, index) => ({ ...catalogOf(1)[0], id: `gospel-${index}`, artist: `Gospel Artist ${index % 3}`, genre: 'Gospel', createdAt: `2026-09-${String(index + 1).padStart(2, '0')}` })),
    ...Array.from({ length: 6 }, (_, index) => ({ ...catalogOf(1)[0], id: `hip-hop-${index}`, artist: `Rap Artist ${index % 3}`, genre: 'Hip-Hop', createdAt: `2026-09-${String(index + 11).padStart(2, '0')}` })),
    { id: 'untagged', audioUrl: 'audio', artist: 'No Genre', genre: '' }
  ];

  const first = generateUniversalDailyMixSnapshot({ catalog, dateKey: '2026-10-05' });
  const repeated = generateUniversalDailyMixSnapshot({ catalog, dateKey: '2026-10-05' });
  assert.deepEqual(first, repeated);
  assert.equal(first.mixes.some((mix) => mix.name === 'Gospel Mix'), true);
  assert.equal(first.mixes.some((mix) => mix.name === 'Hip-Hop Mix'), true);
  assert.equal(first.mixes.every((mix) => !mix.name.startsWith('Sonara Set')), true);
  assert.ok(first.mixes.length <= 8);

  for (const mix of first.mixes.filter((item) => item.flavor === 'genre')) {
    assert.ok(mix.subtitle.split(' · ').length <= 3);
    assert.ok(mix.trackIds.every((id) => catalog.find((track) => track.id === id)?.genre === mix.name.replace(/ Mix$/, '')));
  }
});

test('universal mixes skip underfilled genres and fall back to Daily Mix', () => {
  const catalog = catalogOf(4).map((track) => ({ ...track, genre: 'Gospel' }));
  const snapshot = generateUniversalDailyMixSnapshot({ catalog, dateKey: '2026-10-05' });
  assert.equal(snapshot.mixes[0].name, 'Daily Mix');
  assert.equal(snapshot.mixes.some((mix) => mix.name === 'Gospel Mix'), false);
  assert.equal(snapshot.mixes.some((mix) => mix.name === 'New Arrivals'), true);
  assert.equal(snapshot.mixes.some((mix) => mix.name === 'Deep Cuts'), true);
});
import test from 'node:test';
import assert from 'node:assert/strict';

import { isSampleCatalog, getCachedCatalog, saveCachedCatalog, clearCachedCatalog } from '../src/catalogUtils.js';

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

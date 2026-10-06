import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHash, parseHashRoute } from '../src/lib/routes.js';

test('maps direct hash routes to existing views and library tabs', () => {
  assert.deepEqual(parseHashRoute('#/library/artists'), {
    view: 'library', libraryTab: 'artists', query: '', hash: '#/library/artists'
  });
  assert.equal(parseHashRoute('#/playlists/genre/gospel').genre, 'gospel');
  assert.equal(parseHashRoute('#/admin').view, 'admin');
});

test('redirects legacy All Music routes to Library Songs', () => {
  assert.deepEqual(parseHashRoute('#/all-music'), {
    view: 'library', libraryTab: 'songs', query: '', hash: '#/library/songs'
  });
  assert.equal(createRouteHash('all-music'), '#/library/songs');
});

test('round-trips a search query into the Library Songs route', () => {
  const hash = createRouteHash('library', { query: 'night drive' });
  assert.equal(hash, '#/library/songs?q=night%20drive');
  assert.deepEqual(parseHashRoute(hash), {
    view: 'library', libraryTab: 'songs', query: 'night drive', hash
  });
});
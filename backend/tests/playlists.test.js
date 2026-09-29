import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLegacyPlaylistEntry, playlistNameKey, normalizePlaylistName } from '../src/playlistStore.js';

test('legacy playlists support both trackIds and tracks arrays', () => {
  const fromTrackIds = normalizeLegacyPlaylistEntry({ id: 'p1', name: ' Summer Mix ', trackIds: ['t1', 't1', 't2'] });
  assert.deepEqual(fromTrackIds.trackIds, ['t1', 't2']);
  assert.equal(fromTrackIds.name, 'Summer Mix');

  const fromTracks = normalizeLegacyPlaylistEntry({ name: ' Chill ', tracks: [{ id: 't3' }, 't3', { trackId: 't4' }, { remoteId: 't5' }] });
  assert.deepEqual(fromTracks.trackIds, ['t3', 't4', 't5']);
  assert.equal(fromTracks.id, null);
});

test('playlist names are normalized and keyed case-insensitively', () => {
  assert.equal(normalizePlaylistName('  Morning Run  '), 'Morning Run');
  assert.equal(playlistNameKey('Morning Run'), 'morning run');
});

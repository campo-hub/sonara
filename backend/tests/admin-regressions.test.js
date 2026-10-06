import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUploaderIdentity } from '../src/adminStatsUtils.js';

test('uploader identities prefer saved usernames and resolve Firebase fallbacks', () => {
  assert.deepEqual(resolveUploaderIdentity({ uploadedBy: 'uid-1' }, { username: 'mwangi_k', email: 'mwangi@gmail.com' }), {
    userKey: 'uid-1', uid: 'uid-1', email: 'mwangi@gmail.com', displayName: 'mwangi_k'
  });
  assert.equal(resolveUploaderIdentity({ uploadedBy: 'uid-2' }, null, { displayName: 'Neema', email: 'neema@example.com' }).displayName, 'neema');
  assert.equal(resolveUploaderIdentity({ uploadedBy: 'uid-3' }, null, { email: 'reader@example.com' }).displayName, 'reader');
  assert.equal(resolveUploaderIdentity({ uploadedBy: 'uid-4' }).displayName, 'Unknown user');
  assert.equal(resolveUploaderIdentity({ uploadedBy: 'anonymous' }).displayName, 'Community');
});

import { buildEmptyLibraryPayload, mergeLibraryData, normalizeLibraryData } from '../src/libraryUtils.js';
import { isAdminUser } from '../src/adminStore.js';

const baseLibrary = {
  preferences: {
    theme: 'dark',
    accent: 'sunset',
    liked: ['a', 'b'],
    volume: 38,
    playlists: ['legacy']
  },
  playlists: [{ id: 'legacy-list', name: 'Legacy' }]
};

test('library normalization strips legacy playlists and preserves liked values', () => {
  const normalized = normalizeLibraryData(baseLibrary);
  assert.deepEqual(normalized.preferences.liked, ['a', 'b']);
  assert.equal(normalized.preferences.theme, 'dark');
  assert.equal('playlists' in normalized.preferences, false);
  assert.deepEqual(normalized.playlists, []);
});

test('mergeLibraryData preserves existing keys and only updates incoming preferences', () => {
  const merged = mergeLibraryData(baseLibrary, { preferences: { theme: 'light', liked: ['a', 'c'], volume: 25 } });
  assert.equal(merged.preferences.theme, 'light');
  assert.equal(merged.preferences.volume, 25);
  assert.deepEqual(merged.preferences.liked, ['a', 'c']);
  assert.deepEqual(merged.playlists, []);
});

test('partial preference updates do not erase appearance keys', () => {
  const merged = mergeLibraryData({ preferences: { accent: '#2F4B6E', accentIntensity: 'immersive', spin: true } }, { preferences: { liked: ['new-track'] } });
  assert.equal(merged.preferences.accent, '#2F4B6E');
  assert.equal(merged.preferences.accentIntensity, 'immersive');
  assert.equal(merged.preferences.spin, true);
});

test('empty library payload returns liked array even when no data exists', () => {
  const payload = buildEmptyLibraryPayload();
  assert.deepEqual(payload.preferences.liked, []);
});

test('isAdminUser requires a verified email for email-based matching', async () => {
  const original = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  try {
    const user = { uid: 'other', email: 'admin@example.com', email_verified: false };
    const result = await isAdminUser(user);
    assert.equal(result, false);
    assert.equal(await isAdminUser({ uid: 'admin-1', email: 'admin@example.com', email_verified: true }), false);
  } finally {
    if (original !== undefined) process.env.MONGODB_URI = original;
  }
});

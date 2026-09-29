import test from 'node:test';
import assert from 'node:assert/strict';

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

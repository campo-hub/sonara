import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFallbackCatalog, buildObjectKey, buildPublicUrl, isAudioFile, isImageFile } from '../src/uploadUtils.js';

test('buildObjectKey preserves folder structure and slugifies names', () => {
  assert.equal(buildObjectKey('album/artist/track.mp3'), 'uploads/album/artist/track.mp3');
  assert.equal(buildObjectKey('track.mp3'), 'uploads/track.mp3');
});

test('buildPublicUrl uses the configured public base URL when present', () => {
  assert.equal(buildPublicUrl('uploads/track.mp3', 'https://cdn.example.com'), 'https://cdn.example.com/uploads/track.mp3');
});

test('buildFallbackCatalog returns valid catalog entries with metadata', () => {
  const fallback = buildFallbackCatalog();
  assert.ok(Array.isArray(fallback));
  assert.ok(fallback.length > 0);
  assert.equal(typeof fallback[0].title, 'string');
  assert.equal(typeof fallback[0].artist, 'string');
  assert.equal(typeof fallback[0].album, 'string');
  assert.ok(Number.isFinite(fallback[0].duration));
  assert.ok(fallback[0].audioUrl || fallback[0].cover);
});

test('audio and image type helpers recognize Sonara supported formats', () => {
  assert.equal(isAudioFile('song.mp3'), true);
  assert.equal(isAudioFile('cover.jpg'), false);
  assert.equal(isImageFile('cover.jpg'), true);
});

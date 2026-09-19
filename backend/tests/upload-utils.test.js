import test from 'node:test';
import assert from 'node:assert/strict';

import { buildObjectKey, buildPublicUrl, isAudioFile, isImageFile } from '../src/uploadUtils.js';

test('buildObjectKey preserves folder structure and slugifies names', () => {
  assert.equal(buildObjectKey('album/artist/track.mp3'), 'uploads/album/artist/track.mp3');
  assert.equal(buildObjectKey('track.mp3'), 'uploads/track.mp3');
});

test('buildPublicUrl uses the configured public base URL when present', () => {
  assert.equal(buildPublicUrl('uploads/track.mp3', 'https://cdn.example.com'), 'https://cdn.example.com/uploads/track.mp3');
});

test('audio and image type helpers recognize Sonara supported formats', () => {
  assert.equal(isAudioFile('song.mp3'), true);
  assert.equal(isAudioFile('cover.jpg'), false);
  assert.equal(isImageFile('cover.jpg'), true);
});

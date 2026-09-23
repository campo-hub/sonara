import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectAudioMimeType,
  isAudioFile,
  isImageFile,
  buildObjectKey,
  deriveTrackId,
  parseTrackMetadataFromName,
  mergeTrackMetadata,
  buildFallbackCatalog
} from '../src/uploadUtils.js';

test('detects mime type from extension, not a hardcoded mp3 default', () => {
  assert.equal(detectAudioMimeType('song.m4a', 'application/octet-stream'), 'audio/mp4');
  assert.equal(detectAudioMimeType('song.flac', 'application/octet-stream'), 'audio/flac');
  assert.equal(detectAudioMimeType('song.ogg', 'application/octet-stream'), 'audio/ogg');
  assert.equal(detectAudioMimeType('song.mp3', 'application/octet-stream'), 'audio/mpeg');
});

test('falls back to a real content-type when the extension is unknown', () => {
  assert.equal(detectAudioMimeType('song.xyz', 'audio/custom'), 'audio/custom');
  assert.equal(detectAudioMimeType('song.xyz', ''), 'application/octet-stream');
});

test('isAudioFile / isImageFile classify by extension', () => {
  assert.equal(isAudioFile('track.m4a'), true);
  assert.equal(isAudioFile('cover.jpg'), false);
  assert.equal(isImageFile('cover.jpg'), true);
  assert.equal(isImageFile('track.m4a'), false);
});

test('the same object key always derives the same track id', () => {
  const key = 'uploads/album/song-ab12cd34.mp3';
  assert.equal(deriveTrackId(key), deriveTrackId(key));
  assert.notEqual(deriveTrackId(key), deriveTrackId('uploads/album/other-ab12cd34.mp3'));
});

test('buildObjectKey sanitizes nested folder paths and keeps the extension', () => {
  const key = buildObjectKey('My Album / Track One!!.mp3');
  assert.match(key, /^uploads\/.*Track-One.*\.mp3$/);
});

test('parseTrackMetadataFromName splits "Artist - Title" filenames', () => {
  const result = parseTrackMetadataFromName('Daft Punk - One More Time.mp3', 'Discovery');
  assert.equal(result.artist, 'Daft Punk');
  assert.equal(result.title, 'One More Time');
  assert.equal(result.album, 'Discovery');
});

test('mergeTrackMetadata prefers embedded tags over filename guesses', () => {
  const result = mergeTrackMetadata(
    { title: 'Real Title', artist: 'Real Artist', album: 'Real Album' },
    'track01.mp3',
    'some-folder'
  );
  assert.equal(result.title, 'Real Title');
  assert.equal(result.artist, 'Real Artist');
  assert.equal(result.album, 'Real Album');
});

test('mergeTrackMetadata falls back to filename when tags are missing', () => {
  const result = mergeTrackMetadata(null, 'Daft Punk - One More Time.mp3', 'Discovery');
  assert.equal(result.artist, 'Daft Punk');
  assert.equal(result.title, 'One More Time');
});

test('buildFallbackCatalog returns populated, playable-looking sample tracks', () => {
  const songs = buildFallbackCatalog();
  assert.ok(songs.length > 0);
  for (const song of songs) {
    assert.ok(song.duration > 0);
    assert.ok(song.audioUrl);
    assert.equal(song.source, 'fallback');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { syncBucketIntoCatalog } from '../src/catalogsync.js';
import { deriveTrackId } from '../src/uploadUtils.js';

const makeDeps = ({ objects, existing = [], base = 'https://pub-de00b21f1e9743ce91e7947956335a70.r2.dev' }) => {
  const store = [...existing];
  return {
    store,
    listObjects: async () => objects,
    listTracks: async () => [...store],
    upsertTrack: async (track) => { store.push(track); },
    publicUrlFor: (key) => (base ? `${base}/${key}` : '')
  };
};

test('finds music in the bucket even when the DB already has a track (the reported bug)', async () => {
  const deps = makeDeps({
    existing: [{ id: 'one-old-upload', objectKey: 'uploads/old-1a2b3c4d.mp3', title: 'Old' }],
    objects: [
      { Key: 'uploads/old-1a2b3c4d.mp3' },
      { Key: 'music/Artist - Song One.mp3' },
      { Key: 'Artist - Root Song.m4a' },
      { Key: 'audio/Album/Track.flac' },
      { Key: 'music/' },
      { Key: 'uploads/cover-x.jpg' }
    ]
  });
  const result = await syncBucketIntoCatalog(deps);
  assert.equal(result.audioFound, 4);
  assert.equal(result.alreadyInCatalog, 1);
  assert.equal(result.added, 3);
  const added = deps.store.filter((t) => t.source === 'bucket');
  assert.equal(added.length, 3);
  assert.ok(added.every((t) => t.audioUrl.startsWith('https://pub.r2.dev/')));
  const song = added.find((t) => t.objectKey === 'music/Artist - Song One.mp3');
  assert.equal(song.title, 'Song One');
  assert.equal(song.artist, 'Artist');
});

test('is idempotent: running twice adds nothing the second time', async () => {
  const deps = makeDeps({ objects: [{ Key: 'music/a - b.mp3' }, { Key: 'music/c - d.mp3' }] });
  assert.equal((await syncBucketIntoCatalog(deps)).added, 2);
  assert.equal((await syncBucketIntoCatalog(deps)).added, 0);
  assert.equal(deps.store.length, 2);
});

test('uses the same id scheme as uploads and does not duplicate them', async () => {
  const key = 'uploads/x-aaaa1111.mp3';
  const deps = makeDeps({ existing: [{ id: deriveTrackId(key), objectKey: key }], objects: [{ Key: key }] });
  assert.equal((await syncBucketIntoCatalog(deps)).added, 0);
});

test('no 200-file cap', async () => {
  const objects = Array.from({ length: 450 }, (_, i) => ({ Key: `music/a${i} - t${i}.mp3` }));
  const deps = makeDeps({ objects });
  assert.equal((await syncBucketIntoCatalog(deps)).added, 450);
});

test('fails loudly if R2_PUBLIC_BASE_URL is missing instead of storing unplayable tracks', async () => {
  const deps = makeDeps({ objects: [{ Key: 'music/a - b.mp3' }], base: '' });
  await assert.rejects(() => syncBucketIntoCatalog(deps), /R2_PUBLIC_BASE_URL/);
  assert.equal(deps.store.length, 0);
});
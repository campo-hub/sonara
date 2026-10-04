import test from 'node:test';
import assert from 'node:assert/strict';

import {
  upsertTrack,
  listTracks,
  claimPendingTracks,
  saveExportBatch,
  getExportBatch,
  updateTrackIf
} from '../src/catalogStore.js';

const track = (id, extra = {}) => ({
  id,
  title: id,
  artist: 'Test Artist',
  audioUrl: `https://example.com/${id}.mp3`,
  createdAt: new Date().toISOString(),
  ...extra
});

test('new tracks are pending and tagged tracks are classified', async () => {
  const pendingId = `state-pending-${Date.now()}`;
  const taggedId = `state-tagged-${Date.now()}`;
  await upsertTrack(track(pendingId));
  await upsertTrack(track(taggedId, { genre: 'Pop', genreSource: 'tag' }));

  const tracks = await listTracks();
  assert.equal(tracks.find((item) => item.id === pendingId).genreStatus, 'pending');
  assert.equal(tracks.find((item) => item.id === taggedId).genreStatus, 'classified');
});

test('re-upsert does not reset an exported track', async () => {
  const id = `state-reread-${Date.now()}`;
  await upsertTrack(track(id));
  const claimedRows = await claimPendingTracks(`batch-${id}`, 500, new Date().toISOString());
  const claimed = claimedRows.find((item) => item.id === id);
  assert.equal(claimed.id, id);

  await upsertTrack(track(id, { title: 'Updated metadata' }));
  const current = (await listTracks()).find((item) => item.id === id);
  assert.equal(current.genreStatus, 'exported');
  assert.equal(current.exportBatchId, `batch-${id}`);
  assert.equal(current.title, 'Updated metadata');
});

test('concurrent in-memory claims produce disjoint batches', async () => {
  const ids = Array.from({ length: 4 }, (_, index) => `state-concurrent-${Date.now()}-${index}`);
  await Promise.all(ids.map((id) => upsertTrack(track(id))));
  const [first, second] = await Promise.all([
    claimPendingTracks(`batch-a-${Date.now()}`, 2, new Date().toISOString()),
    claimPendingTracks(`batch-b-${Date.now()}`, 2, new Date().toISOString())
  ]);
  assert.equal(new Set([...first, ...second].map((item) => item.id)).size, 4);
});

test('export batch ledger preserves the claimed rows for re-download', async () => {
  const batchId = `batch-ledger-${Date.now()}`;
  const rows = [track(`state-ledger-${Date.now()}`)];
  await saveExportBatch({ batchId, trackIds: rows.map((item) => item.id), rows, createdAt: new Date().toISOString(), status: 'open' });
  const stored = await getExportBatch(batchId);
  assert.deepEqual(stored.rows, rows);
  assert.equal(await updateTrackIf('missing', {}, { genreStatus: 'pending' }), false);
});
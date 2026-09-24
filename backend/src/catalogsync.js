import { deriveTrackId, isAudioFile, parseTrackMetadataFromName } from './uploadUtils.js';

const WRITE_CONCURRENCY = 10;

/**
 * Makes sure every audio file that exists in the R2 bucket also exists in the
 * catalog store.
 *
 * What was wrong before: the sync only ran when the catalog was completely
 * empty, only looked under "uploads/", stopped at 200 files, and used a
 * different id scheme than uploads. So music already sitting in the bucket
 * (outside uploads/, or in a bucket that already had 1 track in the DB) never
 * showed up in the frontend.
 *
 * This version: scans the whole bucket, skips anything already known (by
 * object key or id), and only adds what is missing. It is safe to run
 * repeatedly.
 *
 * Dependencies are passed in so this can be unit tested without R2/Mongo.
 */
export async function syncBucketIntoCatalog({ listObjects, publicUrlFor, upsertTrack, listTracks, prefix = '' }) {
  const objects = await listObjects(prefix);
  const audio = objects.filter((obj) => obj?.Key && !String(obj.Key).endsWith('/') && isAudioFile(obj.Key));

  const existing = await listTracks();
  const knownKeys = new Set(existing.map((track) => track.objectKey).filter(Boolean));
  const knownIds = new Set(existing.map((track) => track.id));

  const fresh = [];
  for (const obj of audio) {
    const key = String(obj.Key).replace(/^\/+/, '');
    const id = deriveTrackId(key);
    if (knownKeys.has(key) || knownIds.has(id)) continue;

    const audioUrl = publicUrlFor(key);
    if (!audioUrl) {
      // Better to fail loudly than store tracks that can never play.
      throw new Error('R2_PUBLIC_BASE_URL is not set on the server, so audio URLs cannot be built.');
    }

    const parts = key.split('/');
    const fileName = parts.pop() || 'track';
    const folder = parts.filter((part) => part !== 'uploads').join('/');
    const meta = parseTrackMetadataFromName(fileName, folder);

    fresh.push({
      id,
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      duration: 0, // the player fills this in from the audio itself once played
      cover: '',
      audioUrl,
      objectKey: key,
      source: 'bucket',
      createdAt: obj.LastModified ? new Date(obj.LastModified).toISOString() : new Date().toISOString()
    });
  }

  for (let i = 0; i < fresh.length; i += WRITE_CONCURRENCY) {
    await Promise.all(fresh.slice(i, i + WRITE_CONCURRENCY).map((track) => upsertTrack(track)));
  }

  return {
    objectsInBucket: objects.length,
    audioFound: audio.length,
    alreadyInCatalog: audio.length - fresh.length,
    added: fresh.length
  };
}
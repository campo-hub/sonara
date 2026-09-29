import { getDb, trackExists } from './catalogStore.js';

export function normalizePlaylistName(name = '') {
  return String(name || '').trim();
}

export function playlistNameKey(name = '') {
  return normalizePlaylistName(name).toLowerCase();
}

export async function getPlaylistCollection() {
  const db = await getDb();
  if (!db) return null;
  const col = db.collection('playlists');
  await col.createIndex({ ownerUid: 1, nameLower: 1 }, { unique: true });
  await col.createIndex({ ownerUid: 1, updatedAt: -1 });
  return col;
}

export function normalizeLegacyPlaylistEntry(entry = {}) {
  const item = entry && typeof entry === 'object' ? entry : {};
  const trackIds = Array.isArray(item.trackIds)
    ? item.trackIds
    : Array.isArray(item.tracks)
      ? item.tracks
          .map((track) => (typeof track === 'string' ? track : track?.id || track?.trackId || track?.remoteId || null))
          .filter(Boolean)
      : [];

  return {
    id: item.id || item._id || null,
    name: normalizePlaylistName(item.name || ''),
    description: String(item.description || ''),
    trackIds: [...new Set(trackIds.filter(Boolean))]
  };
}

export async function migrateLegacyPlaylistsForUser(uid, legacyData = []) {
  const playlists = Array.isArray(legacyData) ? legacyData : [];
  if (!playlists.length) return [];

  const collection = await getPlaylistCollection();
  if (!collection) return [];

  const existing = await collection.countDocuments({ ownerUid: uid });
  if (existing > 0) {
    return await listUserPlaylists(uid, collection);
  }

  const migrated = [];
  for (const item of playlists) {
    const legacy = normalizeLegacyPlaylistEntry(item);
    if (!legacy.name) continue;

    const validTrackIds = [];
    for (const trackId of legacy.trackIds) {
      if (await trackExists(trackId)) validTrackIds.push(trackId);
    }

    const doc = {
      id: legacy.id || cryptoRandomId(),
      ownerUid: uid,
      name: legacy.name,
      nameLower: playlistNameKey(legacy.name),
      trackIds: validTrackIds.slice(0, 5000),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rev: 1
    };

    try {
      await collection.insertOne(doc);
      migrated.push(doc);
    } catch {
      // Ignore collisions and continue migrating the rest.
    }
  }

  const db = await getDb();
  if (db) {
    await db.collection('userLibraries').updateOne(
      { uid },
      { $set: { 'data.playlistsMigratedAt': new Date().toISOString() } },
      { upsert: true }
    );
  }

  return migrated;
}

export async function listUserPlaylists(uid, collection = null) {
  const targetCollection = collection || (await getPlaylistCollection());
  if (!targetCollection) return [];
  const docs = await targetCollection.find({ ownerUid: uid }, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).toArray();
  return docs.map((doc) => ({ ...doc, trackIds: Array.isArray(doc.trackIds) ? doc.trackIds : [] }));
}

export function cryptoRandomId() {
  return 'pl_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function createPlaylistForUser(uid, name) {
  const collection = await getPlaylistCollection();
  if (!collection) return null;
  const trimmed = normalizePlaylistName(name);
  const safeName = trimmed.slice(0, 60);
  if (!safeName) throw new Error('Playlist name is required.');
  const count = await collection.countDocuments({ ownerUid: uid });
  if (count >= 100) throw new Error('You have reached the maximum number of playlists.');

  const existing = await collection.findOne({ ownerUid: uid, nameLower: playlistNameKey(safeName) });
  if (existing) throw new Error('You already have a playlist with that name.');

  const doc = {
    id: cryptoRandomId(),
    ownerUid: uid,
    name: safeName,
    nameLower: playlistNameKey(safeName),
    trackIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rev: 1
  };
  await collection.insertOne(doc);
  return doc;
}

export async function renamePlaylistForUser(uid, id, name) {
  const collection = await getPlaylistCollection();
  if (!collection) return null;
  const trimmed = normalizePlaylistName(name).slice(0, 60);
  if (!trimmed) throw new Error('Playlist name is required.');

  const existing = await collection.findOne({ ownerUid: uid, id });
  if (!existing) return null;

  const duplicate = await collection.findOne({ ownerUid: uid, nameLower: playlistNameKey(trimmed), id: { $ne: id } });
  if (duplicate) throw new Error('You already have a playlist with that name.');

  const updated = {
    ...existing,
    name: trimmed,
    nameLower: playlistNameKey(trimmed),
    updatedAt: new Date().toISOString(),
    rev: (Number(existing.rev) || 0) + 1
  };

  await collection.updateOne({ ownerUid: uid, id }, { $set: updated });
  return updated;
}

export async function deletePlaylistForUser(uid, id) {
  const collection = await getPlaylistCollection();
  if (!collection) return false;
  const result = await collection.deleteOne({ ownerUid: uid, id });
  return result.deletedCount > 0;
}

export async function addTrackToPlaylist(uid, id, trackId) {
  const collection = await getPlaylistCollection();
  if (!collection) return { added: false, playlist: null };
  const playlist = await collection.findOne({ ownerUid: uid, id });
  if (!playlist) return { added: false, playlist: null };
  if (!(await trackExists(trackId))) throw new Error('Track not found.');
  if (playlist.trackIds.length >= 5000) throw new Error('Playlist has reached the maximum number of tracks.');

  const alreadyIncluded = (playlist.trackIds || []).includes(trackId);
  if (alreadyIncluded) {
    return { added: false, playlist };
  }

  const nextTrackIds = [...(playlist.trackIds || []), trackId];
  const updated = {
    ...playlist,
    trackIds: nextTrackIds,
    updatedAt: new Date().toISOString(),
    rev: (Number(playlist.rev) || 0) + 1
  };

  await collection.updateOne({ ownerUid: uid, id }, { $set: updated });
  return { added: true, playlist: updated };
}

export async function removeTrackFromPlaylist(uid, id, trackId) {
  const collection = await getPlaylistCollection();
  if (!collection) return false;
  const playlist = await collection.findOne({ ownerUid: uid, id });
  if (!playlist) return false;
  const nextTrackIds = (playlist.trackIds || []).filter((candidate) => candidate !== trackId);
  if (nextTrackIds.length === (playlist.trackIds || []).length) return false;
  await collection.updateOne({ ownerUid: uid, id }, { $set: { trackIds: nextTrackIds, updatedAt: new Date().toISOString(), rev: (Number(playlist.rev) || 0) + 1 } });
  return true;
}

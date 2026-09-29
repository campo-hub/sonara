import { getTrackCollection, isMongoConfigured } from './catalogStore.js';

const memoryProfiles = new Map();

async function getUserCollection() {
  if (!isMongoConfigured()) return null;
  const tracks = await getTrackCollection();
  if (!tracks) return null;
  const collection = tracks.s.db.collection('userProfiles');
  await collection.createIndex({ uid: 1 }, { unique: true });
  await collection.createIndex({ usernameLower: 1 }, { unique: true });
  return collection;
}

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateUsername(value) {
  const username = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$/.test(username)) {
    return 'Username must be 2-30 characters and use only letters, numbers, dots, dashes, or underscores.';
  }
  return '';
}

export async function getUserProfile(uid) {
  const collection = await getUserCollection();
  if (collection) return collection.findOne({ uid }, { projection: { _id: 0 } });
  return memoryProfiles.get(uid) || null;
}

export async function saveUserProfile({ uid, email, username }) {
  const usernameValue = String(username || '').trim();
  const usernameLower = normalizeUsername(usernameValue);
  const profile = {
    uid,
    email: String(email || '').toLowerCase(),
    username: usernameValue,
    usernameLower,
    updatedAt: new Date().toISOString()
  };
  const collection = await getUserCollection();
  if (collection) {
    await collection.updateOne(
      { uid },
      { $set: profile, $setOnInsert: { createdAt: new Date().toISOString() } },
      { upsert: true }
    );
    return profile;
  }

  for (const existing of memoryProfiles.values()) {
    if (existing.uid !== uid && existing.usernameLower === usernameLower) {
      const error = new Error('That username is already in use.');
      error.code = 11000;
      throw error;
    }
  }
  memoryProfiles.set(uid, profile);
  return profile;
}
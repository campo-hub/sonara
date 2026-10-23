import { getDb, isMongoConfigured } from './db.js';

const memoryUsers = new Map();

async function getUserCollection() {
  if (!isMongoConfigured()) return null;
  const db = await getDb();
  return db.collection('users');
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
  return memoryUsers.get(uid) || null;
}

export async function getUserRoles(uid) {
  const profile = await getUserProfile(uid);
  return Array.isArray(profile?.roles) ? profile.roles : ['buyer'];
}

export async function saveUserProfile({ uid, email, username }) {
  const usernameValue = String(username || '').trim();
  const usernameLower = normalizeUsername(usernameValue);
  const profile = {
    uid,
    email: String(email || '').trim().toLowerCase(),
    username: usernameValue,
    usernameLower,
    updatedAt: new Date()
  };
  const collection = await getUserCollection();
  if (collection) {
    await collection.updateOne(
      { uid },
      { $set: profile, $setOnInsert: { roles: ['buyer'], createdAt: new Date() } },
      { upsert: true }
    );
    return getUserProfile(uid);
  }

  for (const existing of memoryUsers.values()) {
    if (existing.uid !== uid && existing.usernameLower === usernameLower) {
      const error = new Error('That username is already in use.');
      error.code = 11000;
      throw error;
    }
  }
  const existing = memoryUsers.get(uid);
  const saved = { ...existing, ...profile, roles: existing?.roles || ['buyer'], createdAt: existing?.createdAt || new Date() };
  memoryUsers.set(uid, saved);
  return saved;
}

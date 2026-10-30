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

export async function listUserProfiles(limit = 100) {
  const collection = await getUserCollection();
  if (!collection) return [...memoryUsers.values()].slice(0, limit);
  return collection.find({}, {
    projection: { _id: 0, uid: 1, email: 1, username: 1, roles: 1, sellerProfile: 1, createdAt: 1, updatedAt: 1 }
  }).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function getUserRoles(uid) {
  const profile = await getUserProfile(uid);
  const roles = Array.isArray(profile?.roles) ? profile.roles : ['buyer'];
  return profile?.sellerProfile?.suspended ? roles.filter((role) => role !== 'seller') : roles;
}

export async function getPublicSellerProfile(uid) {
  const profile = await getUserProfile(uid);
  if (!profile || !profile.roles?.includes('seller')
    || profile.sellerProfile?.suspended || !profile.sellerProfile) return null;
  return {
    uid: profile.uid,
    displayName: profile.sellerProfile.displayName,
    bio: profile.sellerProfile.bio,
    county: profile.sellerProfile.county,
    town: profile.sellerProfile.town,
    verified: profile.sellerProfile.verified === true
  };
}

export async function updateSellerAdminState(uid, fields) {
  const collection = await getUserCollection();
  const update = { ...fields };
  if (collection) {
    const result = await collection.findOneAndUpdate(
      { uid, roles: 'seller' },
      { $set: update },
      { returnDocument: 'after', projection: { _id: 0 } }
    );
    return result || null;
  }
  const current = memoryUsers.get(uid);
  if (!current || !current.roles?.includes('seller')) return null;
  const saved = structuredClone(current);
  for (const [path, value] of Object.entries(update)) {
    const keys = path.split('.');
    let target = saved;
    for (const key of keys.slice(0, -1)) target = target[key] ||= {};
    target[keys[keys.length - 1]] = value;
  }
  memoryUsers.set(uid, saved);
  return saved;
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

export async function saveSellerProfile({ uid, email, displayName, bio, county, town }) {
  const collection = await getUserCollection();
  const existing = await getUserProfile(uid);
  if (existing?.sellerProfile?.suspended) {
    const error = new Error('This seller account is suspended.');
    error.status = 403;
    error.code = 'SELLER_SUSPENDED';
    throw error;
  }
  const sellerProfile = {
    displayName,
    bio,
    county,
    town,
    verified: existing?.sellerProfile?.verified === true
  };
  const updatedAt = new Date();
  if (collection) {
    await collection.updateOne(
      { uid },
      {
        $set: { email: String(email || '').trim().toLowerCase(), sellerProfile, updatedAt },
        $addToSet: { roles: { $each: ['buyer', 'seller'] } },
        $setOnInsert: { uid, createdAt: updatedAt }
      },
      { upsert: true }
    );
    return getUserProfile(uid);
  }
  const saved = {
    ...(existing || { uid, email: String(email || '').trim().toLowerCase(), createdAt: updatedAt }),
    sellerProfile,
    roles: [...new Set([...(existing?.roles || ['buyer']), 'seller'])],
    updatedAt
  };
  memoryUsers.set(uid, saved);
  return saved;
}

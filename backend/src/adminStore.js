import { getTrackCollection, isMongoConfigured } from './catalogStore.js';

let memoryAdminDoc = null;

async function getAdminCollection() {
  if (!isMongoConfigured()) return null;
  const col = await getTrackCollection();
  if (!col) return null;
  const db = col.s.db;
  return db.collection('adminConfig');
}

export async function getAdminConfig() {
  const col = await getAdminCollection();
  if (col) {
    return await col.findOne({ _id: 'primary_admin' });
  }
  return memoryAdminDoc;
}

export async function claimAdmin({ uid, email, displayName }) {
  const existing = await getAdminConfig();
  if (existing) {
    return { success: false, message: 'Admin account has already been claimed.' };
  }
  const adminDoc = {
    _id: 'primary_admin',
    uid: uid || 'admin_local',
    email: (email || 'admin@sonara.app').toLowerCase(),
    displayName: displayName || email?.split('@')[0] || 'Admin Owner',
    claimedAt: new Date().toISOString()
  };

  const col = await getAdminCollection();
  if (col) {
    await col.updateOne({ _id: 'primary_admin' }, { $set: adminDoc }, { upsert: true });
  } else {
    memoryAdminDoc = adminDoc;
  }
  return { success: true, admin: adminDoc };
}

export async function isAdminUser(user) {
  if (!user) return false;
  const admin = await getAdminConfig();
  if (!admin) return false;

  if (user.uid && user.uid === admin.uid) return true;

  const userEmail = String(user.email || '').trim().toLowerCase();
  const adminEmail = String(admin.email || '').trim().toLowerCase();
  const emailVerified = Boolean(user.email_verified);

  return Boolean(userEmail && emailVerified && adminEmail && userEmail === adminEmail);
}

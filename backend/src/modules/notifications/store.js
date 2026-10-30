import { getDb, isMongoConfigured } from '../../db.js';

const memoryNotifications = new Map();

export async function insertNotification(notification) {
  if (!isMongoConfigured()) {
    const key = `${notification.uid}:${notification.eventKey}`;
    if ([...memoryNotifications.values()].some((item) => `${item.uid}:${item.eventKey}` === key)) {
      return [...memoryNotifications.values()].find((item) => `${item.uid}:${item.eventKey}` === key);
    }
    memoryNotifications.set(notification.id, notification);
    return notification;
  }
  const db = await getDb();
  try {
    await db.collection('notifications').insertOne(notification);
    return notification;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return db.collection('notifications').findOne(
      { uid: notification.uid, eventKey: notification.eventKey },
      { projection: { _id: 0 } }
    );
  }
}

export async function listNotifications(uid, limit = 50) {
  if (!isMongoConfigured()) {
    return [...memoryNotifications.values()].filter((item) => item.uid === uid)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }
  const db = await getDb();
  return db.collection('notifications').find({ uid }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function countUnreadNotifications(uid) {
  if (!isMongoConfigured()) {
    return [...memoryNotifications.values()].filter((item) => item.uid === uid && !item.readAt).length;
  }
  const db = await getDb();
  return db.collection('notifications').countDocuments({ uid, readAt: null });
}

export async function markNotificationRead(uid, id, at = new Date()) {
  if (!isMongoConfigured()) {
    const item = memoryNotifications.get(id);
    if (!item || item.uid !== uid) return null;
    const updated = { ...item, readAt: item.readAt || at };
    memoryNotifications.set(id, updated);
    return updated;
  }
  const db = await getDb();
  const collection = db.collection('notifications');
  const updated = await collection.findOneAndUpdate(
    { uid, id, readAt: null },
    { $set: { readAt: at } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  if (updated) return updated;
  return collection.findOne(
    { uid, id },
    { projection: { _id: 0 } }
  );
}

export async function markAllNotificationsRead(uid, at = new Date()) {
  if (!isMongoConfigured()) {
    let modifiedCount = 0;
    for (const [id, item] of memoryNotifications) {
      if (item.uid === uid && !item.readAt) {
        memoryNotifications.set(id, { ...item, readAt: at });
        modifiedCount += 1;
      }
    }
    return modifiedCount;
  }
  const db = await getDb();
  const result = await db.collection('notifications').updateMany(
    { uid, readAt: null }, { $set: { readAt: at } }
  );
  return result.modifiedCount;
}

export function resetNotificationMemoryForTests() {
  memoryNotifications.clear();
}

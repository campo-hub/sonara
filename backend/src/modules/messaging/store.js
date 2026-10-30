import { getDb, isMongoConfigured } from '../../db.js';

const conversations = new Map();
const messages = new Map();
const messageReports = new Map();
const pairKey = (uids, productId) => JSON.stringify([...uids].sort().concat(productId));

export async function getOrCreateConversation({ id, productId, productTitle, participants, now }) {
  const participantKey = pairKey(participants, productId);
  if (!isMongoConfigured()) {
    const existing = [...conversations.values()].find((item) => item.participantKey === participantKey
      && item.productId === productId);
    if (existing) return existing;
    const conversation = {
      id, productId, productTitle, participants, participantKey,
      readAt: {}, createdAt: now, lastMessageAt: now, lastMessage: ''
    };
    conversations.set(id, conversation);
    return conversation;
  }
  const db = await getDb();
  const collection = db.collection('conversations');
  try {
    return await collection.findOneAndUpdate(
      { participantKey, productId },
      { $setOnInsert: {
        id, productId, productTitle, participants, participantKey,
        readAt: {}, createdAt: now, lastMessageAt: now, lastMessage: ''
      } },
      { upsert: true, returnDocument: 'after', projection: { _id: 0 } }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return collection.findOne({ participantKey, productId }, { projection: { _id: 0 } });
  }
}

export async function getConversation(id) {
  if (!isMongoConfigured()) return conversations.get(id) || null;
  const db = await getDb();
  return db.collection('conversations').findOne({ id }, { projection: { _id: 0 } });
}

export async function listConversations(uid) {
  if (!isMongoConfigured()) {
    return [...conversations.values()].filter((item) => item.participants.includes(uid))
      .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  }
  const db = await getDb();
  return db.collection('conversations').find(
    { participants: uid }, { projection: { _id: 0 } }
  ).sort({ lastMessageAt: -1 }).limit(100).toArray();
}

export async function insertMessage(message) {
  if (!isMongoConfigured()) {
    messages.set(message.id, message);
    const conversation = conversations.get(message.conversationId);
    if (conversation) conversations.set(conversation.id, {
      ...conversation,
      lastMessage: message.text,
      lastMessageAt: message.createdAt,
      readAt: { ...conversation.readAt, [message.senderUid]: message.createdAt }
    });
    return message;
  }
  const db = await getDb();
  await db.collection('messages').insertOne(message);
  await db.collection('conversations').updateOne(
    { id: message.conversationId },
    { $set: { lastMessage: message.text, lastMessageAt: message.createdAt, [`readAt.${message.senderUid}`]: message.createdAt } }
  );
  return message;
}

export async function listMessages(conversationId, { before, limit }) {
  if (!isMongoConfigured()) {
    return [...messages.values()].filter((item) => item.conversationId === conversationId
      && (!before || new Date(item.createdAt) < new Date(before.createdAt)
        || (new Date(item.createdAt).valueOf() === new Date(before.createdAt).valueOf() && item.id < before.id)))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }
  const db = await getDb();
  return db.collection('messages').find({
    conversationId,
    ...(before ? { $or: [
      { createdAt: { $lt: new Date(before.createdAt) } },
      { createdAt: new Date(before.createdAt), id: { $lt: before.id } }
    ] } : {})
  }, { projection: { _id: 0 } }).sort({ createdAt: -1, id: -1 }).limit(limit).toArray();
}

export async function markConversationRead(id, uid, at) {
  if (!isMongoConfigured()) {
    const conversation = conversations.get(id);
    if (!conversation) return null;
    const updated = { ...conversation, readAt: { ...conversation.readAt, [uid]: at } };
    conversations.set(id, updated);
    return updated;
  }
  const db = await getDb();
  return db.collection('conversations').findOneAndUpdate(
    { id, participants: uid },
    { $set: { [`readAt.${uid}`]: at } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
}

export async function insertMessageReport(report) {
  if (!isMongoConfigured()) {
    messageReports.set(report.id, report);
    return report;
  }
  const db = await getDb();
  await db.collection('messageReports').insertOne(report);
  return report;
}

export async function listMessageReports(limit = 50) {
  if (!isMongoConfigured()) {
    return [...messageReports.values()].filter((item) => item.status === 'open')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }
  const db = await getDb();
  return db.collection('messageReports').find({ status: 'open' }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function getMessageReport(id) {
  if (!isMongoConfigured()) return messageReports.get(id) || null;
  const db = await getDb();
  return db.collection('messageReports').findOne({ id, status: 'open' }, { projection: { _id: 0 } });
}

export function resetMessagingMemoryForTests() {
  conversations.clear();
  messages.clear();
  messageReports.clear();
}

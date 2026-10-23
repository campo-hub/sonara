import { getDb, isMongoConfigured } from '../../db.js';

const memoryReports = new Map();

export async function createProductReport(report) {
  if (!isMongoConfigured()) {
    const key = `${report.productId}:${report.reporterUid}`;
    if (memoryReports.has(key)) {
      const error = new Error('This listing has already been reported by this account.');
      error.code = 11000;
      throw error;
    }
    memoryReports.set(key, report);
    return report;
  }
  const db = await getDb();
  await db.collection('reports').insertOne(report);
  return report;
}

export async function listOpenProductReports(limit = 50) {
  if (!isMongoConfigured()) {
    return [...memoryReports.values()]
      .filter((report) => report.status === 'open')
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, limit);
  }
  const db = await getDb();
  return db.collection('reports').find({ status: 'open' }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function getProductReport(id) {
  if (!isMongoConfigured()) {
    return [...memoryReports.values()].find((report) => report.id === id) || null;
  }
  const db = await getDb();
  return db.collection('reports').findOne({ id }, { projection: { _id: 0 } });
}

export async function resolveProductReport(id) {
  if (!isMongoConfigured()) {
    const entry = [...memoryReports.entries()].find(([, report]) => report.id === id);
    if (!entry || entry[1].status !== 'open') return null;
    const [key, report] = entry;
    const updated = { ...report, status: 'resolved', resolvedAt: new Date() };
    memoryReports.set(key, updated);
    return updated;
  }
  const db = await getDb();
  const result = await db.collection('reports').findOneAndUpdate(
    { id, status: 'open' },
    { $set: { status: 'resolved', resolvedAt: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  return result || null;
}

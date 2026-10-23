import { Router } from 'express';
import { config } from '../../config.js';
import { getDb, isMongoConfigured } from '../../db.js';

const router = Router();

router.get('/health', async (_req, res) => {
  let db = 'down';
  if (isMongoConfigured()) {
    try {
      const database = await getDb();
      await database.command({ ping: 1 });
      db = 'ok';
    } catch {
      db = 'down';
    }
  }

  res.json({
    status: db === 'ok' ? 'ok' : 'degraded',
    uptime: process.uptime(),
    db,
    version: config.version
  });
});

export default router;

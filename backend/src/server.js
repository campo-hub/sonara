import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { assertRuntimeConfig, config } from './config.js';
import { closeDb, ensureIndexes, getDb } from './db.js';
import { orderService } from './modules/orders/service.js';

export async function startServer() {
  assertRuntimeConfig();
  const db = await getDb();
  if (db) await ensureIndexes(db);

  const server = createServer(createApp());
  const reservationTimer = setInterval(() => {
    orderService.expireReservations().catch((error) => {
      console.error('Order reservation expiry failed; reserved stock may need reconciliation.');
    });
  }, 60_000);
  reservationTimer.unref();
  server.once('close', () => clearInterval(reservationTimer));
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(config.port, resolveListen);
  });
  return server;
}

const entrypoint = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (entrypoint) {
  try {
    const server = await startServer();
    console.log(`AgriStore API listening on port ${config.port}.`);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => server.close(async () => {
        await closeDb();
        process.exit(0);
      }));
    }
  } catch (error) {
    const message = String(error?.message || '');
    const knownConfigurationError = /^(MONGODB_URI is required|PORT must be|Every CORS_ORIGIN|CORS_ORIGIN entries|PESAPAL_)/.test(message);
    console.error(knownConfigurationError
      ? message
      : 'Backend startup failed while connecting to MongoDB. Check database availability and credentials.');
    process.exitCode = 1;
  }
}

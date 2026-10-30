import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createApp } from '../src/app.js';
import { assertRuntimeConfig } from '../src/config.js';
import { createRequireAuth } from '../src/middleware/auth.js';
import { createErrorHandler, HttpError } from '../src/middleware/errors.js';
import { createStrictRateLimiter } from '../src/middleware/rateLimit.js';
import { clearRoleCache, createRequireRole } from '../src/middleware/roles.js';
import { getUserProfile, getUserRoles, saveUserProfile, validateUsername } from '../src/userStore.js';

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`
  };
}

function close(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

test('requireAuth rejects missing/invalid credentials and attaches verified token claims', async () => {
  const middleware = createRequireAuth(async (token) => {
    if (token !== 'valid') throw new Error('invalid token');
    return { uid: 'user-1', email: 'farmer@example.test', email_verified: true };
  });
  const invoke = (authorization) => new Promise((resolve) => {
    const req = { headers: authorization ? { authorization } : {} };
    middleware(req, {}, (error) => resolve({ error, user: req.user }));
  });

  assert.equal((await invoke()).error.status, 401);
  assert.equal((await invoke('Bearer invalid')).error.status, 401);
  assert.deepEqual((await invoke('Bearer valid')).user, {
    uid: 'user-1',
    email: 'farmer@example.test',
    email_verified: true,
    name: ''
  });
});

test('requireRole checks database roles and only grants allowlisted admins with verified email', async () => {
  clearRoleCache();
  const roleLookup = async (uid) => uid === 'seller-1' ? ['buyer', 'seller'] : ['buyer'];
  const requireSeller = createRequireRole('seller', { lookup: roleLookup });
  const requireAdmin = createRequireRole('admin', {
    lookup: roleLookup,
    adminEmails: new Set(['admin@example.test'])
  });
  const invoke = (middleware, user) => new Promise((resolve) => {
    middleware({ user }, {}, (error) => resolve(error || null));
  });

  assert.equal((await invoke(requireSeller, { uid: 'seller-1' })), null);
  assert.equal((await invoke(requireSeller, { uid: 'buyer-1' })).status, 403);
  assert.equal((await invoke(requireSeller, null)).status, 401);
  assert.equal((await invoke(requireAdmin, {
    uid: 'admin-1',
    email: 'admin@example.test',
    email_verified: false
  })).status, 403);
  assert.equal(await invoke(requireAdmin, {
    uid: 'admin-1',
    email: 'admin@example.test',
    email_verified: true
  }), null);
});

test('strict rate limiter returns 429 after the configured request limit', async (context) => {
  const app = express();
  app.use(createStrictRateLimiter({ windowMs: 60_000, limit: 1 }));
  app.get('/', (_req, res) => res.json({ ok: true }));
  const { server, url } = await listen(app);
  context.after(() => close(server));

  const first = await fetch(url);
  const second = await fetch(url);
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, 'RATE_LIMITED');
});

test('production error handler returns safe generic errors without stack traces', async (context) => {
  const app = express();
  app.get('/unexpected', () => {
    const error = new Error('private internal details');
    error.stack = 'private stack trace';
    throw error;
  });
  app.get('/known', (_req, _res, next) => next(new HttpError(403, 'Forbidden.', 'FORBIDDEN')));
  app.use(createErrorHandler({ isProduction: true }));
  const { server, url } = await listen(app);
  context.after(() => close(server));

  const unexpected = await (await fetch(`${url}/unexpected`)).json();
  assert.deepEqual(unexpected, {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' }
  });
  assert.equal(JSON.stringify(unexpected).includes('private'), false);
  assert.deepEqual(await (await fetch(`${url}/known`)).json(), {
    error: { code: 'FORBIDDEN', message: 'Forbidden.' }
  });
});

test('runtime configuration rejects production without MongoDB and invalid CORS entries', () => {
  const base = { isProduction: true, mongoUri: '', port: 4000, corsOrigins: new Set() };
  assert.throws(() => assertRuntimeConfig(base), /MONGODB_URI is required/);
  assert.throws(() => assertRuntimeConfig({ ...base, mongoUri: 'mongodb://db', corsOrigins: new Set(['*']) }), /exact origins/);
  assert.doesNotThrow(() => assertRuntimeConfig({ ...base, mongoUri: 'mongodb://db' }));
  const pesapal = {
    environment: 'sandbox',
    consumerKey: 'key',
    consumerSecret: 'secret',
    callbackUrl: 'https://web.example.test/payment',
    ipnUrl: 'https://api.example.test/api/payments/pesapal/ipn',
    ipnId: 'registered-ipn'
  };
  assert.throws(() => assertRuntimeConfig({
    ...base,
    mongoUri: 'mongodb://db',
    pesapal
  }), /must be live when NODE_ENV=production/);
  assert.throws(() => assertRuntimeConfig({
    ...base,
    mongoUri: 'mongodb://db',
    pesapal: { ...pesapal, environment: 'live', ipnId: '' }
  }), /PESAPAL_IPN_ID must be configured/);
  assert.throws(() => assertRuntimeConfig({
    ...base,
    mongoUri: 'mongodb://db',
    pesapal: { ...pesapal, callbackUrl: 'http://localhost/payment' }
  }), /absolute HTTPS URLs/);
});

test('user profiles normalize email, default to buyer, and enforce username uniqueness', async () => {
  assert.equal(validateUsername('valid_name-1'), '');
  assert.match(validateUsername('x'), /2-30 characters/);
  const profile = await saveUserProfile({
    uid: 'profile-user-1',
    email: 'FARMER@EXAMPLE.TEST',
    username: 'FarmUser'
  });
  assert.equal(profile.email, 'farmer@example.test');
  assert.deepEqual(await getUserRoles('profile-user-1'), ['buyer']);
  assert.equal((await getUserProfile('profile-user-1')).usernameLower, 'farmuser');
  await assert.rejects(
    saveUserProfile({ uid: 'profile-user-2', email: 'other@example.test', username: 'FarmUser' }),
    { code: 11000 }
  );
});

test('app exposes health/auth only, sets security headers, enforces body size, and rejects legacy origins', async (context) => {
  const { server, url } = await listen(createApp());
  context.after(() => close(server));

  const healthResponse = await fetch(`${url}/api/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(Object.keys(health).sort(), ['db', 'status', 'uptime', 'version']);
  assert.ok(healthResponse.headers.get('x-content-type-options'));

  const authResponse = await fetch(`${url}/api/auth/me`);
  assert.equal(authResponse.status, 401);
  assert.equal((await authResponse.json()).error.code, 'UNAUTHENTICATED');
  assert.match(authResponse.headers.get('cache-control'), /no-store/);

  const oldMusicRoute = await fetch(`${url}/api/catalog`);
  assert.equal(oldMusicRoute.status, 404);
  assert.equal((await oldMusicRoute.json()).error.code, 'NOT_FOUND');
  assert.equal((await fetch(`${url}/api/admin/claim`, { method: 'POST' })).status, 404);

  const oversized = await fetch(`${url}/api/auth/me`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: 'x'.repeat(110_000) })
  });
  assert.equal(oversized.status, 413);

  const legacyOrigin = await fetch(`${url}/api/health`, {
    headers: { Origin: 'https://campo-hub.github.io' }
  });
  assert.equal(legacyOrigin.status, 403);
});

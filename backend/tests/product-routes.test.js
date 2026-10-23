import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import sharp from 'sharp';
import { createProductRouter } from '../src/modules/products/routes.js';
import { createErrorHandler } from '../src/middleware/errors.js';
import { createUserRateLimiter } from '../src/middleware/rateLimit.js';

const users = {
  seller: { uid: 'seller-1', email: 'seller@example.test' },
  otherSeller: { uid: 'seller-2', email: 'other@example.test' },
  buyer: { uid: 'buyer-1', email: 'buyer@example.test' },
  admin: { uid: 'admin-1', email: 'admin@example.test' }
};

function makeStore() {
  const products = new Map();
  let productsHaveOrders = false;
  return {
    products,
    setProductsHaveOrders(value) {
      productsHaveOrders = value;
    },
    async insertProduct(product) {
      products.set(product.id, structuredClone(product));
      return product;
    },
    async getProductById(id) {
      return structuredClone(products.get(id) || null);
    },
    async listProductsForSeller(uid) {
      return [...products.values()].filter((product) => product.sellerUid === uid);
    },
    async updateProduct(id, update) {
      const current = products.get(id);
      if (!current) return null;
      const saved = { ...current, ...structuredClone(update) };
      products.set(id, saved);
      return structuredClone(saved);
    },
    async productHasOrders() {
      return productsHaveOrders;
    },
    async deleteProductRecord(id) {
      const current = products.get(id) || null;
      products.delete(id);
      return current;
    }
  };
}

function makeStorage({ failThumbUpload = false } = {}) {
  const objects = new Map();
  const deleted = [];
  return {
    objects,
    deleted,
    async putObject(key, body, contentType, options) {
      if (failThumbUpload && key.endsWith('-thumb.webp')) throw new Error('simulated storage failure');
      objects.set(key, { body, contentType, options });
    },
    async deleteObject(key) {
      deleted.push(key);
      objects.delete(key);
    },
    publicUrlFor(key) {
      return `https://images.example.test/${key}`;
    }
  };
}

async function createHarness(options = {}) {
  const store = options.store || makeStore();
  const storage = options.storage || makeStorage();
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  const authMiddleware = (req, _res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    req.user = users[token] || null;
    next();
  };
  const requireSellerMiddleware = (req, _res, next) => {
    if (!req.user) {
      const error = new Error('Sign in to continue.');
      error.status = 401;
      error.code = 'UNAUTHENTICATED';
      return next(error);
    }
    if (req.user.uid !== 'seller-1' && req.user.uid !== 'seller-2') {
      const error = new Error('Seller access required.');
      error.status = 403;
      error.code = 'FORBIDDEN';
      return next(error);
    }
    return next();
  };
  const optionalAuthMiddleware = authMiddleware;
  app.use('/api', createProductRouter({
    store,
    storage,
    authMiddleware,
    optionalAuthMiddleware,
    requireSellerMiddleware,
    isAdmin: async (req) => req.user?.uid === 'admin-1',
    moderateListings: options.moderateListings ?? false,
    rateLimiter: options.rateLimiter
  }));
  app.use(createErrorHandler({ isProduction: true }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    store,
    storage,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

async function pngBuffer(width = 80, height = 40) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 130, b: 50 } }
  }).png().toBuffer();
}

function makeProductForm({ image, fields = {} } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    title: 'Fresh maize',
    description: 'Fresh produce from Kiambu.',
    category: 'cereals',
    unit: 'kg',
    pricePerUnit: '75',
    minOrder: '1',
    quantityAvailable: '20',
    county: 'Kiambu',
    town: 'Thika',
    latitude: '-1.12345',
    longitude: '36.98765',
    ...fields
  })) {
    form.set(key, value);
  }
  if (image) form.append('images', new Blob([image.buffer], { type: image.type || 'application/octet-stream' }), image.name || 'photo.jpg');
  return form;
}

function auth(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

test('product writes require authentication and seller role; spoofed image extensions do not pass content checks', async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  const unauthenticated = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    body: makeProductForm()
  });
  assert.equal(unauthenticated.status, 401);

  const buyer = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('buyer'),
    body: makeProductForm()
  });
  assert.equal(buyer.status, 403);

  const fakeJpeg = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('seller'),
    body: makeProductForm({ image: { buffer: Buffer.from('<svg></svg>'), name: 'fake.jpg', type: 'image/jpeg' } })
  });
  assert.equal(fakeJpeg.status, 415);
  assert.equal((await fakeJpeg.json()).error.code, 'UNSUPPORTED_IMAGE');

  const tooManyImagesForm = makeProductForm();
  const validImage = await pngBuffer();
  for (let index = 0; index < 6; index += 1) {
    tooManyImagesForm.append('images', new Blob([validImage]), `photo-${index}.png`);
  }
  const tooManyImages = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('seller'),
    body: tooManyImagesForm
  });
  assert.equal(tooManyImages.status, 400);
});

test('product creation normalizes images, rounds coordinates, and stores cacheable WebP objects', async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  const response = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('seller'),
    body: makeProductForm({ image: { buffer: await pngBuffer(), name: 'farm.png', type: 'text/plain' } })
  });
  assert.equal(response.status, 201);
  const { product } = await response.json();
  assert.equal(product.status, 'active');
  assert.deepEqual(product.location.geo, { type: 'Point', coordinates: [36.99, -1.12] });
  assert.equal(product.images.length, 1);
  assert.equal(product.images[0].width, 80);
  assert.equal(product.images[0].height, 40);
  const stored = harness.storage.objects.get(product.images[0].key);
  assert.equal(stored.contentType, 'image/webp');
  assert.equal(stored.options.cacheControl, 'public, max-age=31536000, immutable');
  assert.equal(stored.body.toString('ascii', 8, 12), 'WEBP');
  const imageMetadata = await sharp(stored.body).metadata();
  assert.equal(imageMetadata.format, 'webp');
  assert.equal(imageMetadata.exif, undefined);

  const publicRead = await fetch(`${harness.url}/api/products/${product.id}`);
  assert.equal(publicRead.status, 200);
  assert.match(publicRead.headers.get('cache-control'), /public/);
});

test('oversized image upload receives a clear 413 response', async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  const response = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('seller'),
    body: makeProductForm({ image: { buffer: Buffer.alloc(5 * 1024 * 1024 + 1), name: 'large.jpg' } })
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'IMAGE_TOO_LARGE');
});

test('moderated products start pending and are visible only to their owner', async (context) => {
  const harness = await createHarness({ moderateListings: true });
  context.after(harness.close);

  const response = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('seller'),
    body: makeProductForm()
  });
  const { product } = await response.json();
  assert.equal(response.status, 201);
  assert.equal(product.status, 'pending');

  const anonymousRead = await fetch(`${harness.url}/api/products/${product.id}`);
  assert.equal(anonymousRead.status, 404);
  const ownerRead = await fetch(`${harness.url}/api/products/${product.id}`, { headers: auth('seller') });
  assert.equal(ownerRead.status, 200);
  assert.equal((await ownerRead.json()).product.status, 'pending');
  const sellerProducts = await fetch(`${harness.url}/api/me/products`, { headers: auth('seller') });
  assert.equal(sellerProducts.status, 200);
  assert.match(sellerProducts.headers.get('cache-control'), /no-store/);
  assert.equal((await sellerProducts.json()).products[0].status, 'pending');
});

test('upload rate limiting is per authenticated user', async (context) => {
  const harness = await createHarness({ rateLimiter: createUserRateLimiter({ windowMs: 60_000, limit: 1 }) });
  context.after(harness.close);

  const first = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('seller'),
    body: makeProductForm()
  });
  const limited = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('seller'),
    body: makeProductForm()
  });
  const otherUser = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('otherSeller'),
    body: makeProductForm()
  });
  assert.equal(first.status, 201);
  assert.equal(limited.status, 429);
  assert.equal(otherUser.status, 201);
});

test('partial R2 upload failure removes objects already written', async (context) => {
  const storage = makeStorage({ failThumbUpload: true });
  const harness = await createHarness({ storage });
  context.after(harness.close);

  const response = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('seller'),
    body: makeProductForm({ image: { buffer: await pngBuffer(), name: 'farm.png' } })
  });
  assert.equal(response.status, 500);
  assert.equal(storage.objects.size, 0);
  assert.equal(storage.deleted.length, 1);
});

test('edit/delete enforce ownership; image edits, pause/resume and soft/hard delete work', async (context) => {
  const harness = await createHarness();
  context.after(harness.close);
  const createdResponse = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('seller'),
    body: makeProductForm({ image: { buffer: await pngBuffer(), name: 'farm.png' } })
  });
  const product = (await createdResponse.json()).product;

  const forbiddenEdit = await fetch(`${harness.url}/api/products/${product.id}`, {
    method: 'PATCH',
    headers: { ...auth('otherSeller'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Changed by another seller' })
  });
  assert.equal(forbiddenEdit.status, 403);
  const forbiddenDelete = await fetch(`${harness.url}/api/products/${product.id}`, {
    method: 'DELETE',
    headers: auth('otherSeller')
  });
  assert.equal(forbiddenDelete.status, 403);

  const addedImage = await pngBuffer(20, 10);
  const patchForm = new FormData();
  patchForm.set('title', 'Updated maize');
  patchForm.set('imageOrder', JSON.stringify([product.images[0].key]));
  patchForm.append('images', new Blob([addedImage]), 'additional.png');
  const patched = await fetch(`${harness.url}/api/products/${product.id}`, {
    method: 'PATCH',
    headers: auth('seller'),
    body: patchForm
  });
  assert.equal(patched.status, 200);
  const patchedProduct = (await patched.json()).product;
  assert.equal(patchedProduct.title, 'Updated maize');
  assert.equal(patchedProduct.images.length, 2);

  const paused = await fetch(`${harness.url}/api/products/${product.id}/pause`, {
    method: 'POST',
    headers: auth('seller')
  });
  assert.equal((await paused.json()).product.status, 'paused');
  const hidden = await fetch(`${harness.url}/api/products/${product.id}`);
  assert.equal(hidden.status, 404);
  const resumed = await fetch(`${harness.url}/api/products/${product.id}/resume`, {
    method: 'POST',
    headers: auth('seller')
  });
  assert.equal((await resumed.json()).product.status, 'active');

  harness.store.setProductsHaveOrders(true);
  const softDelete = await fetch(`${harness.url}/api/products/${product.id}`, {
    method: 'DELETE',
    headers: auth('seller')
  });
  assert.equal(softDelete.status, 200);
  assert.equal((await softDelete.json()).deleted, false);
  assert.equal((await harness.store.getProductById(product.id)).status, 'removed');
  assert.equal(harness.storage.objects.size, 4);

  harness.store.setProductsHaveOrders(false);
  const hardDelete = await fetch(`${harness.url}/api/products/${product.id}`, {
    method: 'DELETE',
    headers: auth('admin')
  });
  assert.equal(hardDelete.status, 200);
  assert.deepEqual(await hardDelete.json(), { deleted: true });
  assert.equal(harness.storage.objects.size, 0);
  assert.equal(await harness.store.getProductById(product.id), null);
});

test('product patch can remove images and reject unknown or client-supplied ownership fields', async (context) => {
  const harness = await createHarness();
  context.after(harness.close);
  const created = await fetch(`${harness.url}/api/products`, {
    method: 'POST',
    headers: auth('seller'),
    body: makeProductForm({ image: { buffer: await pngBuffer(), name: 'farm.png' } })
  });
  const product = (await created.json()).product;

  const forbiddenField = await fetch(`${harness.url}/api/products/${product.id}`, {
    method: 'PATCH',
    headers: { ...auth('seller'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sellerUid: 'attacker' })
  });
  assert.equal(forbiddenField.status, 400);

  const removed = await fetch(`${harness.url}/api/products/${product.id}`, {
    method: 'PATCH',
    headers: { ...auth('seller'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeImageKeys: [product.images[0].key] })
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).product.images.length, 0);
  assert.equal(harness.storage.objects.size, 0);
});

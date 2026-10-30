import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createErrorHandler } from '../src/middleware/errors.js';
import {
  encodeBrowseCursor,
  parseBrowseQuery,
  toBrowseProduct
} from '../src/modules/products/browse.js';
import { browseProductsFromMemory } from '../src/modules/products/store.js';
import { createProductRouter } from '../src/modules/products/routes.js';

function listing({
  id,
  title = id,
  status = 'active',
  category = 'vegetables',
  county = 'Kiambu',
  pricePerUnit = 100,
  quantityAvailable = 10,
  quantityReserved = 0,
  createdAt = new Date('2026-10-01T00:00:00.000Z'),
  ratingAvg = 0,
  ratingCount = 0,
  coordinates = [36.8, -1.2],
  sellerUid = 'seller-1'
}) {
  return {
    id,
    sellerUid,
    title,
    description: `${title} fresh produce`,
    status,
    category,
    pricePerUnit,
    quantityAvailable,
    quantityReserved,
    location: { county, town: 'Town', geo: { type: 'Point', coordinates } },
    createdAt,
    ratingAvg,
    ratingCount,
    images: [{
      key: `${id}/full.webp`,
      url: `https://img.example.test/${id}/full.webp`,
      thumbKey: `${id}/thumb.webp`,
      thumbUrl: `https://img.example.test/${id}/thumb.webp`,
      width: 1200,
      height: 800
    }]
  };
}

function options(overrides = {}) {
  return parseBrowseQuery(overrides);
}

async function startServer(app) {
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

test('browse query validates filters, prices, coordinates, sorts and pagination size', () => {
  assert.equal(options({ q: 'maize', category: 'cereals', county: 'Kiambu', minPrice: '10', maxPrice: '200' }).filters.q, 'maize');
  assert.equal(options({ limit: '60' }).limit, 60);
  assert.equal(options({ category: 'new farmer category' }).filters.category, 'new farmer category');
  assert.throws(() => options({ category: 'bad/category' }), /category is not supported/);
  assert.throws(() => options({ limit: '61' }), /limit must be between/);
  assert.throws(() => options({ minPrice: '10.5' }), /whole-shilling/);
  assert.throws(() => options({ minPrice: '200', maxPrice: '100' }), /cannot exceed/);
  assert.throws(() => options({ lat: '-1.2' }), /provided together/);
  assert.throws(() => options({ sort: 'nearest' }), /required for nearest/);
  assert.throws(() => options({ radiusKm: '10' }), /required when using radiusKm/);
  assert.throws(() => options({ sort: 'oldest' }), /sort is not supported/);
});

test('browse filters only active, available products and applies search/category/county/price', () => {
  const products = [
    listing({ id: 'tomato', title: 'Tomato', category: 'vegetables', pricePerUnit: 80 }),
    listing({ id: 'maize', title: 'Maize', category: 'cereals', pricePerUnit: 90 }),
    listing({ id: 'paused', status: 'paused' }),
    listing({ id: 'sold-out', quantityAvailable: 4, quantityReserved: 4 }),
    listing({ id: 'high-price', pricePerUnit: 900 }),
    listing({ id: 'other-county', county: 'Nakuru' })
  ];
  const result = browseProductsFromMemory(products, options({
    q: 'tomato',
    category: 'vegetables',
    county: 'kiambu',
    minPrice: '50',
    maxPrice: '100'
  }));
  assert.deepEqual(result.items.map((item) => item.id), ['tomato']);
  const visible = browseProductsFromMemory(products, options());
  assert.equal(visible.items.some((item) => ['paused', 'sold-out'].includes(item.id)), false);
});

test('all supported sorts are deterministic and nearest enforces radius', () => {
  const products = [
    listing({ id: 'a', pricePerUnit: 100, ratingAvg: 4.5, ratingCount: 2, coordinates: [36.8, -1.2] }),
    listing({ id: 'b', pricePerUnit: 50, ratingAvg: 5, ratingCount: 1, coordinates: [36.82, -1.2] }),
    listing({ id: 'c', pricePerUnit: 50, ratingAvg: 5, ratingCount: 3, coordinates: [39, 0] })
  ];
  assert.deepEqual(browseProductsFromMemory(products, options({ sort: 'price_asc' })).items.map((item) => item.id), ['b', 'c', 'a']);
  assert.deepEqual(browseProductsFromMemory(products, options({ sort: 'price_desc' })).items.map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(browseProductsFromMemory(products, options({ sort: 'top_rated' })).items.map((item) => item.id), ['c', 'b', 'a']);
  const nearest = browseProductsFromMemory(products, options({
    sort: 'nearest',
    lat: '-1.2',
    lng: '36.8',
    radiusKm: '5'
  }));
  assert.deepEqual(nearest.items.map((item) => item.id), ['a', 'b']);
  assert.ok(nearest.items[0].distanceMeters < nearest.items[1].distanceMeters);
});

test('keyset pagination remains stable when newer products are inserted between page requests', () => {
  const products = Array.from({ length: 7 }, (_, index) => listing({
    id: `product-${index}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, index))
  }));
  const firstOptions = options({ limit: '3', sort: 'newest' });
  const firstPage = browseProductsFromMemory(products, firstOptions);
  const cursor = encodeBrowseCursor(firstPage.items.at(-1), firstOptions.sort, firstOptions.fingerprint);
  products.push(listing({ id: 'inserted-new', createdAt: new Date('2026-10-24T00:00:00.000Z') }));
  const secondOptions = options({ limit: '3', sort: 'newest', cursor });
  const secondPage = browseProductsFromMemory(products, secondOptions);
  const thirdCursor = encodeBrowseCursor(secondPage.items.at(-1), secondOptions.sort, secondOptions.fingerprint);
  const thirdPage = browseProductsFromMemory(products, options({ limit: '3', sort: 'newest', cursor: thirdCursor }));
  const ids = [...firstPage.items, ...secondPage.items, ...thirdPage.items].map((item) => item.id);
  assert.deepEqual(ids, ['product-6', 'product-5', 'product-4', 'product-3', 'product-2', 'product-1', 'product-0']);
  assert.equal(new Set(ids).size, ids.length);
  assert.throws(() => options({ limit: '2', sort: 'newest', cursor }), /does not match/);
});

test('browse list routes return thumbnails and public cache headers, but disable shared cache for signed-in callers', async (context) => {
  const products = [listing({ id: 'public-product' })];
  const store = {
    async browseProducts(pageOptions) {
      return browseProductsFromMemory(products, pageOptions);
    },
    async listActiveProductsForSeller(uid) {
      return products.filter((product) => product.sellerUid === uid && product.status === 'active');
    }
  };
  const authMiddleware = (req, _res, next) => {
    req.user = req.headers.authorization === 'Bearer buyer' ? { uid: 'buyer-1' } : null;
    next();
  };
  const app = express();
  app.use('/api', createProductRouter({
    store,
    getSellerProfile: async (uid) => uid === 'seller-1'
      ? { uid, displayName: 'Local Farm', bio: '', county: 'Kiambu', town: 'Town', verified: true }
      : null,
    authMiddleware,
    optionalAuthMiddleware: authMiddleware,
    requireSellerMiddleware: (_req, _res, next) => next(),
    isAdmin: async () => false,
    rateLimiter: (_req, _res, next) => next()
  }));
  app.use(createErrorHandler({ isProduction: true }));
  const server = await startServer(app);
  context.after(server.close);

  const publicList = await fetch(`${server.url}/api/products`);
  const publicPayload = await publicList.json();
  assert.match(publicList.headers.get('cache-control'), /stale-while-revalidate/);
  assert.equal(publicPayload.products[0].thumbUrl, 'https://img.example.test/public-product/thumb.webp');
  assert.equal(publicPayload.products[0].images[0].url, undefined);
  assert.equal(publicPayload.products[0].images[0].thumbUrl, 'https://img.example.test/public-product/thumb.webp');

  const privateList = await fetch(`${server.url}/api/products`, { headers: { Authorization: 'Bearer buyer' } });
  assert.match(privateList.headers.get('cache-control'), /no-store/);

  const categoriesResponse = await fetch(`${server.url}/api/categories`);
  const categories = await categoriesResponse.json();
  assert.equal(categories.categories.some((category) => category.id === 'cereals'), true);

  const sellerResponse = await fetch(`${server.url}/api/sellers/seller-1`);
  const sellerPayload = await sellerResponse.json();
  assert.equal(sellerPayload.seller.verified, true);
  assert.equal(sellerPayload.products.length, 1);
  assert.equal(sellerPayload.products[0].thumbUrl, 'https://img.example.test/public-product/thumb.webp');
  assert.equal(JSON.stringify(sellerPayload).includes('seller@example.test'), false);
});

test('browse list returns 400 for a cursor from another filter and never includes inactive products', async (context) => {
  const products = [listing({ id: 'a' }), listing({ id: 'b' }), listing({ id: 'hidden', status: 'paused' })];
  const store = {
    browseProducts(pageOptions) {
      return browseProductsFromMemory(products, pageOptions);
    }
  };
  const app = express();
  app.use('/api', createProductRouter({
    store,
    authMiddleware: (_req, _res, next) => next(),
    optionalAuthMiddleware: (_req, _res, next) => next(),
    requireSellerMiddleware: (_req, _res, next) => next(),
    isAdmin: async () => false,
    rateLimiter: (_req, _res, next) => next()
  }));
  app.use(createErrorHandler({ isProduction: true }));
  const server = await startServer(app);
  context.after(server.close);

  const page = await (await fetch(`${server.url}/api/products?limit=1`)).json();
  const wrongCursor = await fetch(`${server.url}/api/products?limit=1&category=cereals&cursor=${page.nextCursor}`);
  assert.equal(wrongCursor.status, 400);
  const all = await (await fetch(`${server.url}/api/products?limit=60`)).json();
  assert.equal(all.products.some((product) => product.id === 'hidden'), false);
});

test('browse result mapping does not include full image URLs or object keys', () => {
  const item = toBrowseProduct(listing({ id: 'thumbnail-check' }));
  assert.equal(item.thumbUrl, 'https://img.example.test/thumbnail-check/thumb.webp');
  assert.equal('key' in item.images[0], false);
  assert.equal('url' in item.images[0], false);
});

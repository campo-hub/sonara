import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient } from '../src/marketplace/lib/api.js';

test('API client includes bearer tokens and JSON body while omitting credentials', async () => {
  let captured;
  const client = createApiClient({
    baseUrl: 'https://api.example.test/api/',
    tokenProvider: async () => 'firebase-token',
    fetcher: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ orders: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.deepEqual(await client.post('/orders', { items: [] }), { orders: [] });
  assert.equal(captured.url, 'https://api.example.test/api/orders');
  assert.equal(captured.options.headers.get('Authorization'), 'Bearer firebase-token');
  assert.equal(captured.options.headers.get('Content-Type'), 'application/json');
  assert.equal(captured.options.credentials, 'omit');
});

test('API client exposes server errors and rejects a missing API base URL', async () => {
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetcher: async () => new Response(JSON.stringify({ error: { code: 'INVALID', message: 'Bad request.' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    })
  });
  await assert.rejects(client.get('/products'), /Bad request/);
  await assert.rejects(createApiClient({ baseUrl: '' }).get('/products'), /not configured/);
});

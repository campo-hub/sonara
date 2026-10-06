import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryCache } from '../src/lib/queryCache.js';

test('deduplicates concurrent requests for the same key', async () => {
  const cache = createQueryCache();
  let calls = 0;
  let resolveRequest;
  const fetcher = () => {
    calls += 1;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };

  const first = cache.fetchQuery('catalog', fetcher);
  const second = cache.fetchQuery('catalog', fetcher);
  assert.equal(first, second);
  await Promise.resolve();
  resolveRequest(['track']);

  assert.deepEqual(await first, ['track']);
  assert.equal(calls, 1);
});

test('uses fresh data until staleTime expires', async () => {
  let time = 1000;
  let calls = 0;
  const cache = createQueryCache({ now: () => time });
  const fetcher = async () => `result-${++calls}`;

  assert.equal(await cache.fetchQuery('stats', fetcher, { staleTime: 60000 }), 'result-1');
  assert.equal(await cache.fetchQuery('stats', fetcher, { staleTime: 60000 }), 'result-1');
  time += 60001;
  assert.equal(await cache.fetchQuery('stats', fetcher, { staleTime: 60000 }), 'result-2');
  assert.equal(calls, 2);
});

test('keeps stale data visible while revalidating and after a refresh error', async () => {
  const cache = createQueryCache();
  await cache.fetchQuery('batches', async () => ['batch-1']);
  let rejectRequest;
  const refresh = cache.fetchQuery('batches', () => new Promise((_resolve, reject) => { rejectRequest = reject; }), { force: true });
  assert.deepEqual(cache.getSnapshot('batches').data, ['batch-1']);
  assert.equal(cache.getSnapshot('batches').isFetching, true);
  await Promise.resolve();
  rejectRequest(new Error('offline'));

  await assert.rejects(refresh, /offline/);
  const snapshot = cache.getSnapshot('batches');
  assert.deepEqual(snapshot.data, ['batch-1']);
  assert.equal(snapshot.status, 'success');
  assert.equal(snapshot.error.message, 'offline');
  assert.equal(snapshot.isFetching, false);
});

test('invalidating a key makes its value stale without dropping it', async () => {
  let calls = 0;
  const cache = createQueryCache({ now: () => 1000 });
  const fetcher = async () => [`Soul ${++calls}`];
  await cache.fetchQuery('genres', fetcher, { staleTime: 60000 });
  cache.invalidate('genres');
  assert.deepEqual(cache.getSnapshot('genres').data, ['Soul 1']);
  assert.equal(cache.getSnapshot('genres').updatedAt, 0);
  assert.deepEqual(await cache.fetchQuery('genres', fetcher, { staleTime: 60000 }), ['Soul 2']);
  assert.equal(calls, 2);
});
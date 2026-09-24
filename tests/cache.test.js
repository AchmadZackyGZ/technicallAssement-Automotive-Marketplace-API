'use strict';

/**
 * Unit tests for the cache policy.
 *
 * These need no Redis server: the redis module's surface is mocked, which lets us
 * assert the behaviour that actually matters - hit/miss accounting, key stability,
 * graceful degradation and invalidation fan-out.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const redis = require('../src/utils/redis');
const cache = require('../src/utils/cache');

/** Install an in-memory stand-in for the redis module. */
function useFakeRedis(t, { enabled = true } = {}) {
  const store = new Map();

  t.mock.method(redis, 'isEnabled', () => enabled);
  t.mock.method(redis, 'get', async (key) => (store.has(key) ? store.get(key) : null));
  t.mock.method(redis, 'set', async (key, value) => {
    store.set(key, value);
    return true;
  });
  t.mock.method(redis, 'invalidateNamespace', async () => 0);

  return store;
}

test('cacheKey is independent of key order', () => {
  const a = cache.cacheKey('search', { make: 'Toyota', city: 'Jakarta', limit: 20 });
  const b = cache.cacheKey('search', { limit: 20, city: 'Jakarta', make: 'Toyota' });

  assert.equal(a, b, 'the same filters in a different order must share a cache entry');
});

test('cacheKey separates namespaces and values', () => {
  assert.notEqual(cache.cacheKey('search', { q: 'a' }), cache.cacheKey('filters', { q: 'a' }));
  assert.notEqual(cache.cacheKey('search', { q: 'a' }), cache.cacheKey('search', { q: 'b' }));
});

test('remember calls the loader once and serves the second call from cache', async (t) => {
  useFakeRedis(t);

  let loaderCalls = 0;
  const loader = async () => {
    loaderCalls += 1;
    return { items: [1, 2, 3] };
  };

  const first = await cache.remember('search', { q: 'toyota' }, loader);
  assert.equal(first.cached, false);
  assert.deepEqual(first.value, { items: [1, 2, 3] });
  assert.equal(loaderCalls, 1);

  const second = await cache.remember('search', { q: 'toyota' }, loader);
  assert.equal(second.cached, true);
  assert.deepEqual(second.value, { items: [1, 2, 3] });
  assert.equal(loaderCalls, 1, 'the loader must not run again on a hit');
});

test('different filters produce different cache entries', async (t) => {
  useFakeRedis(t);

  let loaderCalls = 0;
  const loader = async () => {
    loaderCalls += 1;
    return { n: loaderCalls };
  };

  await cache.remember('search', { make: 'Toyota' }, loader);
  await cache.remember('search', { make: 'Honda' }, loader);

  assert.equal(loaderCalls, 2);
});

test('remember bypasses the cache entirely when Redis is disabled', async (t) => {
  useFakeRedis(t, { enabled: false });

  let loaderCalls = 0;
  const loader = async () => {
    loaderCalls += 1;
    return { ok: true };
  };

  const first = await cache.remember('search', { q: 'x' }, loader);
  const second = await cache.remember('search', { q: 'x' }, loader);

  assert.equal(first.cached, false);
  assert.equal(second.cached, false);
  assert.equal(loaderCalls, 2, 'without a cache every call must hit the source');
});

test('a cache read failure falls through to the loader instead of failing', async (t) => {
  t.mock.method(redis, 'isEnabled', () => true);
  t.mock.method(redis, 'get', async () => {
    throw new Error('connection reset');
  });
  t.mock.method(redis, 'set', async () => true);

  const result = await cache.remember('search', { q: 'x' }, async () => ({ served: 'from-db' }));

  assert.equal(result.cached, false);
  assert.deepEqual(result.value, { served: 'from-db' });
});

test('invalidateCatalog drops every catalogue namespace', async (t) => {
  t.mock.method(redis, 'isEnabled', () => true);

  const seen = [];
  t.mock.method(redis, 'invalidateNamespace', async (namespace) => {
    seen.push(namespace);
    return 2;
  });

  const removed = await cache.invalidateCatalog();

  assert.deepEqual(seen.sort(), [...cache.NAMESPACES].sort());
  assert.equal(removed, cache.NAMESPACES.length * 2);
});

test('invalidateCatalog is a no-op without Redis', async (t) => {
  t.mock.method(redis, 'isEnabled', () => false);
  t.mock.method(redis, 'invalidateNamespace', async () => {
    throw new Error('must not be called');
  });

  assert.equal(await cache.invalidateCatalog(), 0);
});

test('invalidation covers search, filters and suggest', () => {
  assert.deepEqual([...cache.NAMESPACES].sort(), ['filters', 'search', 'suggest']);
});

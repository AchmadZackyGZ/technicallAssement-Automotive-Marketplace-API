'use strict';

/**
 * Redis cache with graceful degradation.
 *
 * The service is a *bonus*, never a hard dependency: if `REDIS_URL` is unset,
 * or the server is down, every helper below silently becomes a no-op and the
 * API keeps serving from PostgreSQL. Callers therefore never need to guard
 * cache access themselves.
 *
 * Keys are namespaced (`amp:` = automotive marketplace) and values are stored
 * as JSON so complex payloads round-trip without surprises.
 */

const { createClient } = require('redis');
const config = require('../config');
const logger = require('./logger');

const KEY_PREFIX = 'amp:';

let client = null;
let ready = false;

if (config.redis.enabled) {
  client = createClient({
    url: config.redis.url,
    socket: {
      // Do not hammer a dead Redis instance; give up quickly and retry lazily.
      reconnectStrategy: (retries) => (retries > 10 ? false : Math.min(retries * 200, 3000)),
    },
  });

  client.on('ready', () => {
    ready = true;
    logger.info('Redis cache connected');
  });

  client.on('end', () => {
    ready = false;
    logger.warn('Redis connection closed');
  });

  client.on('error', (error) => {
    ready = false;
    logger.warn('Redis error - continuing without cache', { error: error.message });
  });

  // Connect in the background: a slow/unavailable Redis must not delay boot.
  client.connect().catch((error) => {
    logger.warn('Initial Redis connection failed - cache disabled', { error: error.message });
  });
} else {
  logger.info('Redis cache disabled (REDIS_URL not set or CACHE_ENABLED=false)');
}

function isEnabled() {
  return Boolean(client) && ready;
}

function buildKey(namespace, parts) {
  return `${KEY_PREFIX}${namespace}:${parts}`;
}

/**
 * Read and JSON-parse a cached value.
 * @returns {Promise<unknown|null>} `null` on miss or when caching is unavailable.
 */
async function get(key) {
  if (!isEnabled()) return null;
  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    logger.warn('Cache read failed', { key, error: error.message });
    return null;
  }
}

/**
 * JSON-serialise and store a value with a TTL (seconds, defaults to config).
 * @returns {Promise<boolean>} whether the write succeeded
 */
async function set(key, value, ttlSeconds = config.redis.ttlSeconds) {
  if (!isEnabled()) return false;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    return true;
  } catch (error) {
    logger.warn('Cache write failed', { key, error: error.message });
    return false;
  }
}

/** Delete a single key. */
async function del(key) {
  if (!isEnabled()) return false;
  try {
    await client.del(key);
    return true;
  } catch (error) {
    logger.warn('Cache delete failed', { key, error: error.message });
    return false;
  }
}

/**
 * Delete every key belonging to a namespace using a non-blocking SCAN loop.
 * Used to invalidate cached search/facet results when listings change.
 */
async function invalidateNamespace(namespace) {
  if (!isEnabled()) return 0;
  const pattern = `${KEY_PREFIX}${namespace}:*`;
  let cursor = '0';
  let deleted = 0;

  try {
    do {
      // eslint-disable-next-line no-await-in-loop -- SCAN is inherently sequential
      const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 200 });
      cursor = reply.cursor;
      if (reply.keys.length) {
        // eslint-disable-next-line no-await-in-loop
        deleted += await client.del(reply.keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    logger.warn('Cache namespace invalidation failed', { namespace, error: error.message });
  }

  if (deleted) logger.debug('Cache namespace invalidated', { namespace, deleted });
  return deleted;
}

/**
 * Cache-aside helper.
 *
 * Runs `loader` only on a miss, then stores the result. A loader failure is
 * never masked by the cache layer.
 *
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} loader
 * @param {number} [ttlSeconds]
 * @returns {Promise<{ value: T, cached: boolean }>}
 */
async function remember(key, loader, ttlSeconds) {
  const hit = await get(key);
  if (hit !== null) return { value: hit, cached: true };

  const value = await loader();
  await set(key, value, ttlSeconds);
  return { value, cached: false };
}

async function healthCheck() {
  if (!client) return { ok: false, enabled: false, reason: 'not-configured' };
  if (!ready) return { ok: false, enabled: true, reason: 'not-connected' };
  try {
    const startedAt = Date.now();
    await client.ping();
    return { ok: true, enabled: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, enabled: true, error: error.message };
  }
}

async function close() {
  if (client && ready) {
    await client.quit().catch(() => client.disconnect());
  } else if (client) {
    client.disconnect();
  }
}

module.exports = {
  isEnabled,
  buildKey,
  get,
  set,
  del,
  invalidateNamespace,
  remember,
  healthCheck,
  close,
  KEY_PREFIX,
};

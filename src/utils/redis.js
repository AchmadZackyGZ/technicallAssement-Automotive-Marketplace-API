'use strict';

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

  client.connect().catch((error) => {
    logger.warn('Initial Redis connection failed - cache disabled', { error: error.message });
  });
} else {
  logger.info('Redis cache disabled (REDIS_URL not set or CACHE_ENABLED=false)');
}

function isEnabled() {
  return Boolean(client) && ready;
}

function status() {
  if (!client) return 'disabled';
  return ready ? 'ready' : 'connecting';
}

function buildKey(namespace, parts) {
  return `${KEY_PREFIX}${namespace}:${parts}`;
}

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

async function invalidateNamespace(namespace) {
  if (!isEnabled()) return 0;
  const pattern = `${KEY_PREFIX}${namespace}:*`;
  let cursor = '0';
  let deleted = 0;

  try {
    do {
      const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 200 });

      cursor = String(reply.cursor ?? '0');

      if (reply.keys.length) {
        deleted += await client.del(reply.keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    logger.warn('Cache namespace invalidation failed', { namespace, error: error.message });
  }

  if (deleted) logger.debug('Cache namespace invalidated', { namespace, deleted });
  return deleted;
}

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
  status,
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

'use strict';

const redis = require('./redis');
const logger = require('./logger');
const { stableHash } = require('./helpers');

const NAMESPACES = ['search', 'filters', 'suggest'];

function cacheKey(namespace, input) {
  return redis.buildKey(namespace, stableHash(input));
}

async function remember(namespace, input, loader) {
  if (!redis.isEnabled()) {
    return { value: await loader(), cached: false };
  }

  const key = cacheKey(namespace, input);

  try {
    const hit = await redis.get(key);
    if (hit !== null) {
      logger.debug('Cache hit', { namespace, key });
      return { value: hit, cached: true };
    }

    const value = await loader();
    await redis.set(key, value);
    return { value, cached: false };
  } catch (error) {
    logger.warn('Cache read-through failed - serving from source', {
      namespace,
      error: error.message,
    });
    return { value: await loader(), cached: false };
  }
}

async function invalidateCatalog() {
  if (!redis.isEnabled()) return 0;

  try {
    const removed = await Promise.all(NAMESPACES.map((namespace) => redis.invalidateNamespace(namespace)));
    const total = removed.reduce((sum, count) => sum + count, 0);

    if (total) logger.info('Catalogue cache invalidated', { keys: total });
    return total;
  } catch (error) {
    logger.warn('Catalogue cache invalidation failed', { error: error.message });
    return 0;
  }
}

module.exports = { NAMESPACES, cacheKey, remember, invalidateCatalog };

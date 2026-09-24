'use strict';

/**
 * Cache policy for the read-heavy catalogue endpoints.
 *
 * WHAT IS CACHED, AND WHY ONLY THAT
 *   Only the three endpoints whose cost is proportional to the size of the
 *   catalogue rather than to the size of the response:
 *
 *     search   - full-text match plus ~10 facet aggregations
 *     filters  - the same aggregations, for the filter panel
 *     suggest  - up to three grouped, ranked DISTINCT scans
 *
 *   GET /listings is deliberately NOT cached. It is a single indexed keyset scan
 *   that returns in well under a millisecond, so a cache round trip would cost
 *   more than the query it replaces and would add a stale window for no gain.
 *
 * KEYS
 *   Derived from the validated request object, hashed with sorted keys, so
 *   `?make=Toyota&city=Jakarta` and `?city=Jakarta&make=Toyota` share one entry.
 *
 * INVALIDATION
 *   The whole namespace is dropped whenever a listing or category changes. That
 *   is deliberately coarse: with a 60-second TTL, surgical per-key invalidation
 *   would buy very little and risk serving a stale facet count, which is the one
 *   thing a faceted search must never do.
 */

const redis = require('./redis');
const logger = require('./logger');
const { stableHash } = require('./helpers');

/** Namespaces owned by this policy. */
const NAMESPACES = ['search', 'filters', 'suggest'];

/** Build the cache key for a request within a namespace. */
function cacheKey(namespace, input) {
  return redis.buildKey(namespace, stableHash(input));
}

/**
 * Cache-aside read.
 *
 * Falls straight through to `loader` when Redis is unavailable, so nothing in
 * the request path has to care whether a cache exists.
 *
 * @template T
 * @param {string} namespace
 * @param {object} input
 * @param {() => Promise<T>} loader
 * @returns {Promise<{ value: T, cached: boolean }>}
 */
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
    // A cache problem must never break the request.
    logger.warn('Cache read-through failed - serving from source', {
      namespace,
      error: error.message,
    });
    return { value: await loader(), cached: false };
  }
}

/**
 * Drop every cached catalogue response.
 *
 * Called after any write that can change a result set or a facet count: creating,
 * updating or soft-deleting a listing, and creating, updating or moving a
 * category.
 *
 * @returns {Promise<number>} keys removed
 */
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

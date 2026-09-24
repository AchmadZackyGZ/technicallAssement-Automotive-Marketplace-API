'use strict';

/**
 * Deterministic helpers for the seed script.
 *
 * The generator is a seeded PRNG (mulberry32) rather than Math.random, so
 * `npm run seed` produces byte-identical data on every machine. That matters for
 * a take-home submission: a reviewer comparing their results against the README,
 * or against a screenshot, sees the same listings.
 */

/** @returns {() => number} a deterministic generator in [0, 1) */
function createRandom(seed = 42) {
  let state = seed >>> 0;

  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer in [min, max] inclusive. */
function intBetween(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

/** Random float in [min, max). */
function floatBetween(random, min, max) {
  return random() * (max - min) + min;
}

/** Pick one element. */
function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

/**
 * Pick one element, respecting an optional `weight` property.
 * Falls back to a uniform pick when no weights are present.
 */
function pickWeighted(random, items) {
  const total = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  let threshold = random() * total;

  for (const item of items) {
    threshold -= item.weight ?? 1;
    if (threshold <= 0) return item;
  }

  return items[items.length - 1];
}

/** `true` with the given probability. */
function chance(random, probability) {
  return random() < probability;
}

/** Shuffle a copy of the array (Fisher-Yates). */
function shuffle(random, items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Insert many rows using multi-row INSERTs.
 *
 * One statement per row would mean thousands of round trips; this batches them
 * (default 200 rows) so a 600-listing seed completes in a couple of seconds.
 *
 * Pass `returning` when the generated ids are needed to build child rows -
 * `RETURNING` preserves input order within each batch, so callers can zip the
 * results back onto the input rows.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} table
 * @param {string[]} columns
 * @param {Array<Array>} rows
 * @param {{ batchSize?: number, returning?: ?string }} [options]
 * @returns {Promise<{ inserted: number, returned: object[] }>}
 */
async function insertInBatches(client, table, columns, rows, { batchSize = 200, returning = null } = {}) {
  if (!rows.length) return { inserted: 0, returned: [] };

  let inserted = 0;
  const returned = [];

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const params = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    // eslint-disable-next-line no-await-in-loop -- batching is the point
    const result = await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}${returning ? ` RETURNING ${returning}` : ''}`,
      params,
    );

    inserted += batch.length;
    if (returning) returned.push(...result.rows);
  }

  return { inserted, returned };
}

/** Placeholder gallery images. Deterministic per seed so they are stable. */
function imageUrls(seedKey, count) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://picsum.photos/seed/${seedKey}-${index + 1}/1024/768`,
    altText: null,
    position: index,
    isPrimary: index === 0,
  }));
}

module.exports = {
  createRandom,
  intBetween,
  floatBetween,
  pick,
  pickWeighted,
  chance,
  shuffle,
  insertInBatches,
  imageUrls,
};

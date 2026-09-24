'use strict';

/**
 * Small, dependency-free helpers shared across modules.
 */

const crypto = require('crypto');

/**
 * Convert arbitrary text into a URL-safe slug.
 * `"Mercedes-Benz"` -> `"mercedes-benz"`, `"SUV / 7-Seater"` -> `"suv-7-seater"`.
 */
function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * Deterministic SHA-1 digest used to build compact, stable cache keys from
 * arbitrarily long query objects.
 */
function stableHash(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

/** Random integer in `[min, max]` inclusive. */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick a random element from an array. */
function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

/** Pick `count` distinct random elements from an array. */
function randomItems(items, count) {
  const pool = [...items];
  const picked = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

/** Return a shuffled copy of an array (Fisher-Yates). */
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** `true` when the value is a plain object (not null, not an array). */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Drop keys whose value is `undefined`, `null` or `''`.
 * Keeps generated SQL/`SET` clauses free of empty fragments.
 */
function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

/** Convert a value to a plain object for JSON responses (pg rows are already plain). */
function toPlain(row) {
  return row ? { ...row } : row;
}

module.exports = {
  slugify,
  stableHash,
  randomInt,
  randomItem,
  randomItems,
  shuffle,
  isPlainObject,
  compact,
  toPlain,
};

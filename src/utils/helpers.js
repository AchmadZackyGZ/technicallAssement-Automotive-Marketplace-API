'use strict';

const crypto = require('crypto');

function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = sortKeysDeep(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function stableHash(value) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(sortKeysDeep(value)))
    .digest('hex')
    .slice(0, 16);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomItems(items, count) {
  const pool = [...items];
  const picked = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function toPlain(row) {
  return row ? { ...row } : row;
}

module.exports = {
  slugify,
  stableHash,
  sortKeysDeep,
  randomInt,
  randomItem,
  randomItems,
  shuffle,
  isPlainObject,
  compact,
  toPlain,
};

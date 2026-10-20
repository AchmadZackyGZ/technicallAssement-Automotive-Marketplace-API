'use strict';

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

function intBetween(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function floatBetween(random, min, max) {
  return random() * (max - min) + min;
}

function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

function pickWeighted(random, items) {
  const total = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  let threshold = random() * total;

  for (const item of items) {
    threshold -= item.weight ?? 1;
    if (threshold <= 0) return item;
  }

  return items[items.length - 1];
}

function chance(random, probability) {
  return random() < probability;
}

function shuffle(random, items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

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

    const result = await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}${returning ? ` RETURNING ${returning}` : ''}`,
      params,
    );

    inserted += batch.length;
    if (returning) returned.push(...result.rows);
  }

  return { inserted, returned };
}

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

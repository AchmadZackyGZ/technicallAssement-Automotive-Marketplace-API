'use strict';

/**
 * Unit tests for cursor pagination.
 *
 * These need no database: they cover the pure encode/decode/build logic that the
 * browse and search endpoints depend on.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SORT_KEYS,
  resolveSort,
  encodeCursor,
  decodeCursor,
  buildKeysetClause,
  normaliseLimit,
  buildPage,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} = require('../src/utils/pagination');

test('resolveSort falls back to the default for unknown keys', () => {
  assert.equal(resolveSort('definitely-not-a-sort').column, 'created_at');
  assert.equal(resolveSort('price_asc').column, 'price');
  assert.equal(resolveSort('price_asc').direction, 'ASC');
});

test('every advertised sort key resolves', () => {
  for (const key of SORT_KEYS) {
    const resolved = resolveSort(key);
    assert.ok(resolved.direction, `sort key ${key} should have a direction`);
    // `relevance` is ordered by a computed expression rather than a column.
    if (key === 'relevance') {
      assert.equal(resolved.column, null);
      assert.equal(resolved.requiresQuery, true);
    } else {
      assert.ok(resolved.column, `sort key ${key} should resolve to a column`);
    }
  }
});

test('a cursor round-trips through encode/decode', () => {
  // Rows are aliased to camelCase by the repositories, so the cursor reads the
  // camelCase property rather than the snake_case database column.
  const row = { id: '11111111-2222-3333-4444-555555555555', createdAt: new Date('2026-01-02T03:04:05.000Z') };
  const cursor = encodeCursor('newest', row);
  const decoded = decodeCursor(cursor, 'newest');

  assert.equal(decoded.id, row.id);
  assert.equal(decoded.v, '2026-01-02T03:04:05.000Z');
  assert.equal(decoded.s, 'newest');
});

test('a malformed cursor is rejected with a 400', () => {
  assert.throws(() => decodeCursor('!!!not-base64!!!', 'newest'), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'BAD_REQUEST');
    return true;
  });
});

test('a cursor is rejected when replayed against a different sort order', () => {
  const cursor = encodeCursor('price_asc', { id: 'abc', price: 1000 });
  assert.throws(() => decodeCursor(cursor, 'newest'), (error) => {
    assert.equal(error.statusCode, 400);
    return true;
  });
});

test('a null cursor produces no keyset clause', () => {
  const { clause, params } = buildKeysetClause({ sortKey: 'newest', cursor: null, paramIndex: 1 });
  assert.equal(clause, '');
  assert.deepEqual(params, []);
});

test('DESC sorts use a less-than row comparison and ASC use greater-than', () => {
  const cursor = { v: '2026-01-01T00:00:00.000Z', id: 'abc' };

  const desc = buildKeysetClause({ sortKey: 'newest', cursor, alias: 'l', paramIndex: 3 });
  assert.match(desc.clause, /\(l\.created_at, l\.id\) </);
  assert.deepEqual(desc.params, [cursor.v, cursor.id]);

  const asc = buildKeysetClause({ sortKey: 'price_asc', cursor, alias: 'l', paramIndex: 1 });
  assert.match(asc.clause, /\(l\.price, l\.id\) >/);
});

test('limit is clamped and defaults sensibly', () => {
  assert.equal(normaliseLimit(undefined), DEFAULT_LIMIT);
  assert.equal(normaliseLimit('abc'), DEFAULT_LIMIT);
  assert.equal(normaliseLimit('0'), DEFAULT_LIMIT);
  assert.equal(normaliseLimit('-5'), DEFAULT_LIMIT);
  assert.equal(normaliseLimit('25'), 25);
  assert.equal(normaliseLimit('100000'), MAX_LIMIT);
});

test('buildPage trims the look-ahead row and exposes the next cursor', () => {
  const rows = [
    { id: 'a', createdAt: '2026-01-03T00:00:00.000Z' },
    { id: 'b', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'c', createdAt: '2026-01-01T00:00:00.000Z' },
  ];

  // limit = 2 with 3 rows means another page exists.
  const page = buildPage(rows, 2, 'newest');

  assert.equal(page.items.length, 2);
  assert.equal(page.pagination.hasMore, true);
  assert.equal(page.pagination.count, 2);
  assert.ok(page.pagination.nextCursor);

  const decoded = decodeCursor(page.pagination.nextCursor, 'newest');
  assert.equal(decoded.id, 'b', 'cursor should point at the last returned row');
});

test('buildPage reports no next cursor on the final page', () => {
  const rows = [{ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }];
  const page = buildPage(rows, 2, 'newest');

  assert.equal(page.pagination.hasMore, false);
  assert.equal(page.pagination.nextCursor, null);
});

test('buildPage handles an empty result set', () => {
  const page = buildPage([], 20, 'newest');
  assert.equal(page.items.length, 0);
  assert.equal(page.pagination.hasMore, false);
  assert.equal(page.pagination.nextCursor, null);
});

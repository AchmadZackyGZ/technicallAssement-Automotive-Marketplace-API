'use strict';

/**
 * Cursor (keyset) pagination.
 *
 * WHY NOT OFFSET?
 *   `LIMIT 20 OFFSET 4000` forces PostgreSQL to generate and discard 4000 rows,
 *   so page 200 costs roughly 200x page 1. It is also unstable: a listing
 *   inserted while a client is paging shifts every subsequent row, producing
 *   duplicates and silently skipped records. With 500+ seeded listings and a
 *   browse endpoint that is the hottest path in the API, neither property is
 *   acceptable.
 *
 * Cursors fix both problems by remembering the *position* rather than a count.
 * The predicate is a row-value comparison:
 *
 *   ORDER BY created_at DESC, id DESC
 *   WHERE (created_at, id) < ($cursorCreatedAt, $cursorId)
 *
 * PostgreSQL evaluates row-value comparisons directly against the composite
 * index `(status, created_at DESC, id DESC)`, so it seeks straight to the
 * cursor and reads exactly `limit` rows - O(log n + limit) regardless of depth.
 *
 * `id` is always the tie-breaker. Without it, rows sharing a `created_at` (very
 * likely with a bulk seed) would be ordered arbitrarily and the same row could
 * appear on two pages, or none.
 */

const { BadRequestError } = require('./errors');

/**
 * Whitelisted sort keys.
 *
 * Clients pass `?sort=newest`; the SQL column and direction are looked up here
 * and never interpolated from user input.
 *
 * `column` is the *database* column, used to build ORDER BY / keyset SQL.
 * `cursorField` is the *row property* carrying that value - the repositories
 * alias every column to camelCase, so the two deliberately differ.
 *
 * `relevance` is special: it only exists when a full-text query is present, and
 * it is ordered by a computed rank rather than a column. `requiresQuery` marks
 * that.
 */
const SORT_OPTIONS = {
  newest: { column: 'created_at', direction: 'DESC', cursorField: 'createdAt' },
  oldest: { column: 'created_at', direction: 'ASC', cursorField: 'createdAt' },
  price_asc: { column: 'price', direction: 'ASC', cursorField: 'price' },
  price_desc: { column: 'price', direction: 'DESC', cursorField: 'price' },
  year_desc: { column: 'year', direction: 'DESC', cursorField: 'year' },
  year_asc: { column: 'year', direction: 'ASC', cursorField: 'year' },
  mileage_asc: { column: 'mileage_km', direction: 'ASC', cursorField: 'mileageKm' },
  mileage_desc: { column: 'mileage_km', direction: 'DESC', cursorField: 'mileageKm' },
  relevance: {
    column: null,
    direction: 'DESC',
    cursorField: 'rank',
    requiresQuery: true,
    note: 'Ordered by ts_rank; falls back to `newest` when no full-text query is supplied.',
  },
};

const DEFAULT_SORT = 'newest';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Sort keys exposed to clients (drives the Zod enum, so bad input 422s). */
const SORT_KEYS = Object.keys(SORT_OPTIONS);

function resolveSort(sortKey) {
  return SORT_OPTIONS[sortKey] || SORT_OPTIONS[DEFAULT_SORT];
}

/**
 * Encode a position into an opaque cursor.
 *
 * Base64url of `{ s, v, id }`: `s` is the sort key, `v` the sort value and `id`
 * the tie-breaker. Embedding the sort key stops a cursor from being replayed
 * against a different ordering, which would silently return wrong results.
 */
function encodeCursor(sortKey, row) {
  if (!row) return null;

  const { cursorField } = resolveSort(sortKey);
  const value = row[cursorField];

  if (value === undefined || value === null) return null;

  const payload = {
    s: sortKey,
    v: value instanceof Date ? value.toISOString() : value,
    id: row.id,
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode and validate a cursor.
 * @throws {BadRequestError} when malformed, or issued for a different sort order
 */
function decodeCursor(cursor, expectedSortKey) {
  if (!cursor) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestError('Malformed pagination cursor', { cursor });
  }

  if (!payload || typeof payload !== 'object' || !payload.id || payload.v === undefined) {
    throw new BadRequestError('Malformed pagination cursor', { cursor });
  }

  if (expectedSortKey && payload.s && payload.s !== expectedSortKey) {
    throw new BadRequestError(
      'Cursor does not match the requested sort order. Restart pagination without a cursor.',
      { cursorSort: payload.s, requestedSort: expectedSortKey },
    );
  }

  return payload;
}

/**
 * Build the keyset predicate for a cursor.
 *
 * @param {object} options
 * @param {string} options.sortKey    Whitelisted sort key
 * @param {object} options.cursor     Decoded cursor payload
 * @param {string} [options.alias]    Table alias for column-based sorts
 * @param {number} options.paramIndex Next free `$n` placeholder index
 * @param {string} [options.expression] SQL expression to compare on, when the
 *                                     sort is computed rather than a column
 *                                     (e.g. `ts_rank(...)`). Only ever built
 *                                     from internal, whitelisted fragments.
 * @returns {{ clause: string, params: Array }}
 */
function buildKeysetClause({ sortKey, cursor, alias = 'l', paramIndex, expression = null }) {
  if (!cursor) return { clause: '', params: [] };

  const { column, direction } = resolveSort(sortKey);
  const operator = direction === 'DESC' ? '<' : '>';

  const left = expression || `${alias}.${column}`;

  // Row-value comparison keeps both columns on a single index scan; splitting it
  // into `col < $1 OR (col = $1 AND id < $2)` is equivalent but harder for the
  // planner to prove index-usable.
  const clause = `(${left}, ${alias}.id) ${operator} ($${paramIndex}, $${paramIndex + 1})`;

  return { clause, params: [cursor.v, cursor.id] };
}

/** Normalise `limit` from an untrusted query value. */
function normaliseLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Turn a page of rows into the API's pagination envelope.
 *
 * The repository fetches `limit + 1` rows; the extra row is the look-ahead that
 * tells us whether another page exists without a second COUNT query.
 */
function buildPage(rows, limit, sortKey) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    pagination: {
      limit,
      count: items.length,
      hasMore,
      sort: sortKey,
      nextCursor: hasMore ? encodeCursor(sortKey, last) : null,
    },
  };
}

module.exports = {
  SORT_OPTIONS,
  SORT_KEYS,
  DEFAULT_SORT,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  resolveSort,
  encodeCursor,
  decodeCursor,
  buildKeysetClause,
  normaliseLimit,
  buildPage,
};

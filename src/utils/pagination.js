'use strict';

const { BadRequestError } = require('./errors');

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

const SORT_KEYS = Object.keys(SORT_OPTIONS);

function resolveSort(sortKey) {
  return SORT_OPTIONS[sortKey] || SORT_OPTIONS[DEFAULT_SORT];
}

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

function buildKeysetClause({ sortKey, cursor, alias = 'l', paramIndex, expression = null }) {
  if (!cursor) return { clause: '', params: [] };

  const { column, direction } = resolveSort(sortKey);
  const operator = direction === 'DESC' ? '<' : '>';

  const left = expression || `${alias}.${column}`;

  const clause = `(${left}, ${alias}.id) ${operator} ($${paramIndex}, $${paramIndex + 1})`;

  return { clause, params: [cursor.v, cursor.id] };
}

function normaliseLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

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

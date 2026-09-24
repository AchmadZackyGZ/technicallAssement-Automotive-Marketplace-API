'use strict';

/**
 * Translates a validated filter object into a SQL WHERE / ORDER BY fragment.
 *
 * This is the single place that knows how a filter maps onto the schema, and it
 * is shared by three callers:
 *
 *   - GET /listings                 (browse)
 *   - GET /listings/search          (full-text + faceted search)
 *   - GET /filters, /filters/:id    (facet counts - same WHERE, no ORDER BY)
 *
 * Keeping one translator means a filter can never behave differently between
 * browsing and searching, and every parameter is bound - no value is ever
 * interpolated into the SQL string. The only interpolated fragments are column
 * names and the rank expression, both taken from internal whitelists.
 */

const { resolveSort } = require('../../utils/pagination');

/**
 * Plain column filters. `array` filters accept a list of values (CSV in the
 * query string) and use `= ANY(...)`, which is index-backed.
 */
const COLUMN_FILTERS = [
  { key: 'make', column: 'make', mode: 'array' },
  { key: 'model', column: 'model', mode: 'array' },
  { key: 'condition', column: 'condition', mode: 'array' },
  { key: 'transmission', column: 'transmission', mode: 'array' },
  { key: 'fuelType', column: 'fuel_type', mode: 'array' },
  { key: 'color', column: 'color', mode: 'array' },
  { key: 'city', column: 'location_city', mode: 'array' },
  { key: 'province', column: 'location_province', mode: 'scalar' },
];

/** `{ column, minKey, maxKey }` range filters. */
const RANGE_FILTERS = [
  { column: 'year', minKey: 'yearMin', maxKey: 'yearMax' },
  { column: 'price', minKey: 'priceMin', maxKey: 'priceMax' },
  { column: 'mileage_km', minKey: null, maxKey: 'mileageMax' },
];

/** Values that mean "true" once they have come through a query string. */
function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

/** Normalise a filter value into an array of non-empty strings. */
function toArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Build the query fragments for a listing search.
 *
 * @param {object} input               Validated filter input
 * @param {object} [options]
 * @param {string} [options.alias]     Table alias for the listings table
 * @param {?object} [options.cursor]   Decoded cursor payload
 * @param {?string[]} [options.categoryIds] Pre-resolved category scope (the
 *                                     category plus its descendants)
 * @returns {{ conditions: string[], params: Array, orderBy: string,
 *             keysetExpression: ?string, sortKey: string, queryParamIndex: ?number }}
 */
function buildListingQuery(input = {}, { alias = 'l', cursor = null, categoryIds = null } = {}) {
  const conditions = [];
  const params = [];

  /** Bind a value and return its placeholder, e.g. `$3`. */
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  // --- Full-text search ----------------------------------------------------
  // `websearch_to_tsquery` accepts natural input ("toyota avanza 2019"),
  // tolerates quotes and dashes, and never raises a syntax error on odd input -
  // unlike `to_tsquery`, which would turn a stray character into a 500.
  let queryParamIndex = null;
  if (input.q) {
    queryParamIndex = params.length + 1;
    params.push(input.q);
    conditions.push(`${alias}.search_vector @@ websearch_to_tsquery('simple', $${queryParamIndex})`);
  }

  // --- Category scope ------------------------------------------------------
  // The service resolves the category subtree to a list of ids, so the database
  // does one `= ANY(...)` rather than a correlated subquery per row.
  if (categoryIds && categoryIds.length) {
    conditions.push(`${alias}.category_id = ANY(${bind(categoryIds)}::uuid[])`);
  }

  // --- Visibility ----------------------------------------------------------
  if (input.status) {
    conditions.push(`${alias}.status = ANY(${bind(toArray(input.status))}::text[])`);
  } else {
    conditions.push(`${alias}.status <> 'removed'`);
  }

  if (input.sellerId) {
    conditions.push(`${alias}.seller_id = ${bind(input.sellerId)}`);
  }

  if (input.isFeatured !== undefined) {
    conditions.push(`${alias}.is_featured = ${bind(toBoolean(input.isFeatured))}`);
  }

  // --- Column filters ------------------------------------------------------
  for (const filter of COLUMN_FILTERS) {
    const value = input[filter.key];
    if (value === undefined || value === null || value === '') continue;

    if (filter.mode === 'array') {
      conditions.push(`${alias}.${filter.column} = ANY(${bind(toArray(value))}::text[])`);
    } else {
      conditions.push(`${alias}.${filter.column} = ${bind(String(value))}`);
    }
  }

  // --- Range filters -------------------------------------------------------
  for (const filter of RANGE_FILTERS) {
    const min = filter.minKey ? input[filter.minKey] : undefined;
    const max = filter.maxKey ? input[filter.maxKey] : undefined;

    if (min !== undefined && min !== null) {
      conditions.push(`${alias}.${filter.column} >= ${bind(min)}`);
    }
    if (max !== undefined && max !== null) {
      conditions.push(`${alias}.${filter.column} <= ${bind(max)}`);
    }
  }

  // --- Dynamic (EAV) attribute filters -------------------------------------
  // Syntax: attr[engine_cc][min]=1000, attr[has_sunroof]=true,
  //         attr[drive_type]=FWD  (or a comma-separated list)
  if (input.attr && typeof input.attr === 'object') {
    for (const [key, raw] of Object.entries(input.attr)) {
      if (raw === undefined || raw === null || raw === '') continue;

      const inner = [];
      const keyPlaceholder = bind(key);
      inner.push(`fd.key = ${keyPlaceholder}`);

      const isRange = typeof raw === 'object' && !Array.isArray(raw);
      const asBoolean = !isRange && ['true', 'false'].includes(String(raw).toLowerCase());

      if (isRange) {
        if (raw.min !== undefined && raw.min !== null && raw.min !== '') {
          inner.push(`la.value_num >= ${bind(raw.min)}`);
        }
        if (raw.max !== undefined && raw.max !== null && raw.max !== '') {
          inner.push(`la.value_num <= ${bind(raw.max)}`);
        }
        if (inner.length === 1) continue; // nothing to constrain on
      } else if (asBoolean) {
        inner.push(`la.value_bool = ${bind(toBoolean(raw))}`);
      } else {
        inner.push(`la.value_text = ANY(${bind(toArray(raw))}::text[])`);
      }

      conditions.push(`EXISTS (
        SELECT 1 FROM listing_attributes la
          JOIN filter_definitions fd ON fd.id = la.definition_id
         WHERE la.listing_id = ${alias}.id
           AND ${inner.join('\n           AND ')}
      )`);
    }
  }

  // --- Ordering ------------------------------------------------------------
  // `relevance` is only meaningful with a full-text query; without one the
  // service downgrades the request to `newest` before it reaches this point.
  const sortKey = input.sort || 'newest';
  const { column, direction } = resolveSort(sortKey);

  let orderBy;
  let keysetExpression = null;

  if (sortKey === 'relevance' && queryParamIndex !== null) {
    // The rank expression reuses the already-bound query placeholder, so it
    // stays parameterised rather than inlining user text.
    keysetExpression = `ts_rank(${alias}.search_vector, websearch_to_tsquery('simple', $${queryParamIndex}))`;
    orderBy = `${keysetExpression} DESC, ${alias}.id DESC`;
  } else {
    orderBy = `${alias}.${column} ${direction}, ${alias}.id ${direction}`;
    keysetExpression = `${alias}.${column}`;
  }

  // --- Keyset cursor -------------------------------------------------------
  if (cursor) {
    const operator = direction === 'DESC' ? '<' : '>';
    conditions.push(
      `(${keysetExpression}, ${alias}.id) ${operator} (${bind(cursor.v)}, ${bind(cursor.id)})`,
    );
  }

  return { conditions, params, orderBy, keysetExpression, sortKey, queryParamIndex };
}

module.exports = { buildListingQuery, COLUMN_FILTERS, RANGE_FILTERS, toArray, toBoolean };

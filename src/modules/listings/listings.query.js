'use strict';

const { resolveSort } = require('../../utils/pagination');

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

const RANGE_FILTERS = [
  { column: 'year', minKey: 'yearMin', maxKey: 'yearMax' },
  { column: 'price', minKey: 'priceMin', maxKey: 'priceMax' },
  { column: 'mileage_km', minKey: null, maxKey: 'mileageMax' },
];

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

function toArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildListingQuery(input = {}, { alias = 'l', cursor = null, categoryIds = null } = {}) {
  const conditions = [];
  const params = [];

  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  let queryParamIndex = null;
  if (input.q) {
    queryParamIndex = params.length + 1;
    params.push(input.q);
    const q = `$${queryParamIndex}`;

    const branches = [`${alias}.search_vector @@ websearch_to_tsquery('simple', ${q})`];

    if (input.fuzzy !== false) {
      branches.push(
        `${alias}.title ILIKE '%' || ${q} || '%'`,
        `${alias}.make ILIKE '%' || ${q} || '%'`,
        `${alias}.model ILIKE '%' || ${q} || '%'`,
      );

      const isSingleToken = !/\s/.test(input.q.trim());
      if (isSingleToken && input.q.trim().length >= 4) {
        branches.push(`${alias}.make % ${q}`, `${alias}.model % ${q}`);
      }
    }

    conditions.push(`(${branches.join(' OR ')})`);
  }

  if (categoryIds && categoryIds.length) {
    conditions.push(`${alias}.category_id = ANY(${bind(categoryIds)}::uuid[])`);
  }

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

  for (const filter of COLUMN_FILTERS) {
    const value = input[filter.key];
    if (value === undefined || value === null || value === '') continue;

    if (filter.mode === 'array') {
      conditions.push(`${alias}.${filter.column} = ANY(${bind(toArray(value))}::text[])`);
    } else {
      conditions.push(`${alias}.${filter.column} = ${bind(String(value))}`);
    }
  }

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
        if (inner.length === 1) continue;
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

  const sortKey = input.sort || 'newest';
  const { column, direction } = resolveSort(sortKey);

  let orderBy;
  let keysetExpression = null;

  if (sortKey === 'relevance' && queryParamIndex !== null) {
    keysetExpression = `ts_rank(${alias}.search_vector, websearch_to_tsquery('simple', $${queryParamIndex}))`;
    orderBy = `${keysetExpression} DESC, ${alias}.id DESC`;
  } else {
    orderBy = `${alias}.${column} ${direction}, ${alias}.id ${direction}`;
    keysetExpression = `${alias}.${column}`;
  }

  if (cursor) {
    const operator = direction === 'DESC' ? '<' : '>';
    conditions.push(
      `(${keysetExpression}, ${alias}.id) ${operator} (${bind(cursor.v)}, ${bind(cursor.id)})`,
    );
  }

  return { conditions, params, orderBy, keysetExpression, sortKey, queryParamIndex };
}

module.exports = { buildListingQuery, COLUMN_FILTERS, RANGE_FILTERS, toArray, toBoolean };

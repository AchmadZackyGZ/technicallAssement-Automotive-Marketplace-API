'use strict';

/**
 * Facet computation.
 *
 * Two ideas drive this file:
 *
 * 1. DISJUNCTIVE FACETS.
 *    A facet's counts are computed with that facet's own filter removed, and
 *    every other filter still applied. This is what makes facets usable: after
 *    filtering to Toyota, the make facet must still list Honda with its count,
 *    otherwise there is no way to switch. Meanwhile the city facet should only
 *    count cities within Toyota.
 *
 * 2. ONE FILTER TRANSLATOR.
 *    Counts are computed from the same WHERE fragment the search itself uses
 *    (see listings.query.js). A facet can therefore never disagree with the
 *    result set it describes.
 *
 * The cost is one small GROUP BY per facet group - around ten indexed
 * aggregations per faceted request. That is acceptable at this data size and is
 * exactly what the Redis cache in front of it exists to absorb.
 */

const db = require('../../utils/db');
const logger = require('../../utils/logger');
const { buildListingQuery } = require('../listings/listings.query');
const repository = require('./filters.repository');
const categoriesRepository = require('../categories/categories.repository');

/** Facets backed by a plain column. */
const COLUMN_FACETS = [
  { key: 'make', label: 'Make', column: 'make', limit: 20 },
  { key: 'model', label: 'Model', column: 'model', limit: 20, dependsOn: ['make'] },
  { key: 'condition', label: 'Condition', column: 'condition', limit: 10 },
  { key: 'transmission', label: 'Transmission', column: 'transmission', limit: 10 },
  { key: 'fuelType', label: 'Fuel Type', column: 'fuel_type', limit: 10 },
  { key: 'color', label: 'Colour', column: 'color', limit: 20 },
  { key: 'city', label: 'City', column: 'location_city', limit: 20 },
  { key: 'province', label: 'Province', column: 'location_province', limit: 20 },
];

/**
 * Range facets rendered as buckets, matching how a marketplace UI actually
 * presents price and year filters.
 */
const RANGE_FACETS = [
  {
    key: 'price',
    label: 'Price',
    column: 'price',
    unit: 'IDR',
    buckets: [
      { key: 'under_100m', label: 'Under Rp 100 jt', min: 0, max: 100_000_000 },
      { key: '100m_250m', label: 'Rp 100 - 250 jt', min: 100_000_000, max: 250_000_000 },
      { key: '250m_500m', label: 'Rp 250 - 500 jt', min: 250_000_000, max: 500_000_000 },
      { key: '500m_1b', label: 'Rp 500 jt - 1 M', min: 500_000_000, max: 1_000_000_000 },
      { key: 'over_1b', label: 'Over Rp 1 M', min: 1_000_000_000, max: null },
    ],
  },
  {
    key: 'year',
    label: 'Year',
    column: 'year',
    unit: null,
    buckets: [
      { key: 'before_2015', label: 'Before 2015', min: 0, max: 2015 },
      { key: '2015_2017', label: '2015 - 2017', min: 2015, max: 2018 },
      { key: '2018_2020', label: '2018 - 2020', min: 2018, max: 2021 },
      { key: '2021_2022', label: '2021 - 2022', min: 2021, max: 2023 },
      { key: '2023_plus', label: '2023 and newer', min: 2023, max: null },
    ],
  },
  {
    key: 'mileageKm',
    label: 'Mileage',
    column: 'mileage_km',
    unit: 'km',
    buckets: [
      { key: 'under_20k', label: 'Under 20.000 km', min: 0, max: 20_000 },
      { key: '20k_50k', label: '20.000 - 50.000 km', min: 20_000, max: 50_000 },
      { key: '50k_100k', label: '50.000 - 100.000 km', min: 50_000, max: 100_000 },
      { key: 'over_100k', label: 'Over 100.000 km', min: 100_000, max: null },
    ],
  },
];

/** Pagination/sort keys are irrelevant to a WHERE clause; drop them. */
const NON_FILTER_KEYS = ['cursor', 'limit', 'sort', 'facets', 'facetKeys', 'fuzzy'];

/** Copy the filter input without the given keys. */
function withoutKeys(input, keys) {
  const copy = { ...input };
  for (const key of keys) delete copy[key];
  for (const key of NON_FILTER_KEYS) delete copy[key];
  return copy;
}

/**
 * Build the WHERE fragment for a facet group.
 *
 * @param {object} input      Filter input
 * @param {object} options
 * @param {?string[]} options.categoryIds
 * @param {string[]} [options.exclude]  Top-level keys to drop (disjunctive faceting)
 * @param {?string} [options.excludeAttr] Dynamic attribute key to drop
 */
function buildFacetConditions(input, { categoryIds = null, exclude = [], excludeAttr = null } = {}) {
  const sanitized = withoutKeys(input, exclude);

  if (excludeAttr && sanitized.attr) {
    sanitized.attr = { ...sanitized.attr };
    delete sanitized.attr[excludeAttr];
    if (!Object.keys(sanitized.attr).length) delete sanitized.attr;
  }

  return buildListingQuery(sanitized, { alias: 'l', categoryIds });
}

/** Count listings per value of a column. */
async function computeColumnFacet(facet, input, { categoryIds, limit }) {
  const { conditions, params } = buildFacetConditions(input, {
    categoryIds,
    exclude: [facet.key],
  });

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : 'WHERE TRUE';

  const { rows } = await db.query(
    `SELECT l.${facet.column} AS value, COUNT(*)::int AS count
       FROM listings l
       ${where}
        AND l.${facet.column} IS NOT NULL
      GROUP BY l.${facet.column}
      ORDER BY count DESC, value ASC
      LIMIT ${Number(limit ?? facet.limit ?? 20)}`,
    params,
  );

  return { key: facet.key, label: facet.label, type: 'enum', values: rows };
}

/** Bucket counts plus the true min/max, so a UI can render a slider. */
async function computeRangeFacet(facet, input, { categoryIds }) {
  const { conditions, params } = buildFacetConditions(input, {
    categoryIds,
    exclude: [facet.key],
  });

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : 'WHERE TRUE';

  // One round trip for every bucket: conditional aggregates instead of a UNION
  // per bucket.
  const bucketExpressions = facet.buckets.map((bucket) => {
    const bounds = [`l.${facet.column} >= $${params.length + 1}`];
    params.push(bucket.min);

    if (bucket.max !== null) {
      bounds.push(`l.${facet.column} < $${params.length + 1}`);
      params.push(bucket.max);
    }

    return `COUNT(*) FILTER (WHERE ${bounds.join(' AND ')})::int AS "${bucket.key}"`;
  });

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total,
            MIN(l.${facet.column}) AS min,
            MAX(l.${facet.column}) AS max,
            ${bucketExpressions.join(',\n            ')}
       FROM listings l
       ${where}`,
    params,
  );

  const summary = rows[0];

  return {
    key: facet.key,
    label: facet.label,
    type: 'range',
    unit: facet.unit,
    min: summary.min === null ? null : Number(summary.min),
    max: summary.max === null ? null : Number(summary.max),
    total: summary.total,
    buckets: facet.buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      min: bucket.min,
      max: bucket.max,
      count: summary[bucket.key],
    })),
  };
}

/**
 * Count listings per category.
 *
 * With a scope, counts are returned for the scope's direct children and include
 * each child's whole subtree - expressed as a path prefix join, which is what
 * the materialized path is for. Without a scope, listings are grouped by their
 * directly assigned category.
 */
async function computeCategoryFacet(input, { categoryIds, scopeCategoryId = null }) {
  if (scopeCategoryId) {
    const { conditions, params } = buildFacetConditions(input, {
      categoryIds,
      exclude: ['categoryId', 'categorySlug', 'includeSubcategories'],
    });

    const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';
    params.push(scopeCategoryId);

    const { rows } = await db.query(
      `SELECT child.id,
              child.name,
              child.slug,
              child.depth,
              COUNT(l.id)::int AS count
         FROM categories child
         LEFT JOIN categories c ON c.path LIKE child.path || '%'
         LEFT JOIN listings l ON l.category_id = c.id ${where}
        WHERE child.parent_id = $${params.length}
        GROUP BY child.id, child.name, child.slug, child.depth
        ORDER BY count DESC, child.name ASC`,
      params,
    );

    return { key: 'category', label: 'Category', type: 'enum', values: rows };
  }

  const { conditions, params } = buildFacetConditions(input, {
    categoryIds,
    exclude: ['categoryId', 'categorySlug', 'includeSubcategories'],
  });

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : 'WHERE TRUE';

  const { rows } = await db.query(
    `SELECT c.id, c.name, c.slug, c.depth, COUNT(*)::int AS count
       FROM listings l
       JOIN categories c ON c.id = l.category_id
       ${where}
      GROUP BY c.id, c.name, c.slug, c.depth
      ORDER BY count DESC, c.name ASC
      LIMIT 50`,
    params,
  );

  return { key: 'category', label: 'Category', type: 'enum', values: rows };
}

/**
 * Facets for the category-specific filter attributes declared by the
 * definition registry.
 *
 * This is the part that makes the filter architecture dynamic: declare
 * `drive_type` as an enum attribute on Cars and it appears here, and in the
 * search results, with no code change.
 *
 * @param {?object[]} definitions Pre-fetched effective definitions, if available
 */
async function computeAttributeFacets(input, { categoryIds, scopeCategoryId, facetKeys, definitions = null }) {
  if (!scopeCategoryId) return [];

  const effective = definitions ?? (await repository.findEffectiveDefinitions(scopeCategoryId));

  const groups = [];
  for (const definition of effective) {
    if (!definition.isFacetable) continue;
    if (facetKeys && !facetKeys.includes(definition.key)) continue;
    // Column-backed filters are already covered by COLUMN_FACETS.
    if (definition.source !== 'attribute') continue;

    // eslint-disable-next-line no-await-in-loop -- bounded by the number of declared attributes
    const group = await computeAttributeFacet(definition, input, { categoryIds });
    if (group && (group.type === 'range' || group.values.length)) groups.push(group);
  }

  return groups;
}

async function computeAttributeFacet(definition, input, { categoryIds }) {
  const { conditions, params } = buildFacetConditions(input, {
    categoryIds,
    excludeAttr: definition.key,
  });

  const where = conditions.length ? `${conditions.join(' AND ')} AND` : '';
  params.push(definition.key);
  const keyParam = `$${params.length}`;

  if (definition.type === 'range') {
    const { rows } = await db.query(
      `SELECT MIN(la.value_num) AS min,
              MAX(la.value_num) AS max,
              COUNT(la.value_num)::int AS count
         FROM listings l
         JOIN listing_attributes la ON la.listing_id = l.id
         JOIN filter_definitions fd ON fd.id = la.definition_id
        WHERE ${where} fd.key = ${keyParam}
          AND la.value_num IS NOT NULL`,
      params,
    );

    const summary = rows[0];
    if (!summary || summary.count === 0) return null;

    return {
      key: definition.key,
      label: definition.label,
      type: 'range',
      unit: definition.unit,
      source: 'attribute',
      min: Number(summary.min),
      max: Number(summary.max),
      count: summary.count,
      declaredMin: definition.minValue === null ? null : Number(definition.minValue),
      declaredMax: definition.maxValue === null ? null : Number(definition.maxValue),
    };
  }

  if (definition.type === 'boolean') {
    const { rows } = await db.query(
      `SELECT la.value_bool AS value, COUNT(*)::int AS count
         FROM listings l
         JOIN listing_attributes la ON la.listing_id = l.id
         JOIN filter_definitions fd ON fd.id = la.definition_id
        WHERE ${where} fd.key = ${keyParam}
          AND la.value_bool IS NOT NULL
        GROUP BY la.value_bool
        ORDER BY la.value_bool DESC`,
      params,
    );

    if (!rows.length) return null;

    return {
      key: definition.key,
      label: definition.label,
      type: 'boolean',
      source: 'attribute',
      values: rows.map((row) => ({
        value: row.value,
        label: row.value ? 'Yes' : 'No',
        count: row.count,
      })),
    };
  }

  const { rows } = await db.query(
    `SELECT la.value_text AS value, COUNT(*)::int AS count
       FROM listings l
       JOIN listing_attributes la ON la.listing_id = l.id
       JOIN filter_definitions fd ON fd.id = la.definition_id
      WHERE ${where} fd.key = ${keyParam}
        AND la.value_text IS NOT NULL
      GROUP BY la.value_text
      ORDER BY count DESC, value ASC
      LIMIT 20`,
    params,
  );

  if (!rows.length) return null;

  // Prefer the registry's own labels when the definition declares options.
  const labelByValue = new Map((definition.options ?? []).map((option) => [option.value, option.label]));

  return {
    key: definition.key,
    label: definition.label,
    type: 'enum',
    source: 'attribute',
    values: rows.map((row) => ({
      value: row.value,
      label: labelByValue.get(row.value) ?? row.value,
      count: row.count,
    })),
  };
}

/**
 * Compute every facet group for a filter set.
 *
 * @param {object} input
 * @param {object} [options]
 * @param {?string[]} [options.categoryIds]  Pre-resolved category scope
 * @param {?string}   [options.scopeCategoryId] The category the scope came from
 * @param {?string[]} [options.facetKeys]    Restrict which groups to compute
 * @param {number}    [options.limit]        Max values per categorical facet
 * @returns {Promise<{ groups: object[], ranges: object, counts: object }>}
 */
async function computeFacets(input, { categoryIds = null, scopeCategoryId = null, facetKeys = null, limit } = {}) {
  const wants = (key) => !facetKeys || facetKeys.includes(key);

  // When scoped to a category, the registry decides which column facets exist.
  // That is what keeps "fuel type appears under Cars but not Motorcycles" true
  // for the facet list as well as for the attribute validation.
  const definitions = scopeCategoryId
    ? await repository.findEffectiveDefinitions(scopeCategoryId)
    : null;
  const declaredKeys = definitions ? new Set(definitions.map((definition) => definition.key)) : null;

  const tasks = [];

  if (wants('category')) {
    tasks.push(computeCategoryFacet(input, { categoryIds, scopeCategoryId }));
  }

  for (const facet of COLUMN_FACETS) {
    if (!wants(facet.key)) continue;
    if (declaredKeys && !declaredKeys.has(facet.key)) continue;
    tasks.push(computeColumnFacet(facet, input, { categoryIds, limit }));
  }

  const rangeTasks = RANGE_FACETS.filter((facet) => wants(facet.key)).map((facet) =>
    computeRangeFacet(facet, input, { categoryIds }),
  );

  const [groups, ranges, attributeGroups] = await Promise.all([
    Promise.all(tasks),
    Promise.all(rangeTasks),
    computeAttributeFacets(input, { categoryIds, scopeCategoryId, facetKeys, definitions }),
  ]);

  const rangeByKey = Object.fromEntries(ranges.map((range) => [range.key, range]));

  return {
    groups: [...groups, ...attributeGroups],
    ranges: rangeByKey,
    counts: {
      total: rangeByKey.price?.total ?? null,
      groups: groups.length + attributeGroups.length,
    },
  };
}

/**
 * GET /filters - every filter option with counts, plus the category counts.
 */
async function getFilterOptions(input, { scopeCategoryId = null } = {}) {
  const categoryIds = scopeCategoryId
    ? await categoriesRepository.findSubtreeIds(scopeCategoryId)
    : null;

  const facets = await computeFacets(input, {
    categoryIds,
    scopeCategoryId,
    facetKeys: input.facetKeys ?? null,
    limit: input.valueLimit,
  });

  const definitions = scopeCategoryId
    ? await repository.findEffectiveDefinitions(scopeCategoryId)
    : await listAllDefinitions();

  logger.debug('Filter options computed', {
    scopeCategoryId,
    facetGroups: facets.groups.length,
    definitions: definitions.length,
  });

  return {
    scope: {
      categoryId: scopeCategoryId,
      includeSubcategories: input.includeSubcategories !== false,
    },
    definitions,
    ranges: facets.ranges,
    facets: facets.groups,
    totalMatching: facets.counts.total,
  };
}

/** Definitions across the whole taxonomy, for the unscoped /filters response. */
async function listAllDefinitions() {
  const { rows } = await db.query(
    `SELECT fd.id,
            fd.category_id   AS "categoryId",
            c.slug           AS "categorySlug",
            fd.key,
            fd.label,
            fd.type,
            fd.source,
            fd.column_name   AS "columnName",
            fd.unit,
            fd.options,
            fd.min_value     AS "minValue",
            fd.max_value     AS "maxValue",
            fd.is_filterable AS "isFilterable",
            fd.is_facetable  AS "isFacetable",
            fd.sort_order    AS "sortOrder"
       FROM filter_definitions fd
       JOIN categories c ON c.id = fd.category_id
      ORDER BY c.path ASC, fd.sort_order ASC, fd.label ASC`,
  );
  return rows;
}

module.exports = {
  computeFacets,
  getFilterOptions,
  listAllDefinitions,
  COLUMN_FACETS,
  RANGE_FACETS,
};

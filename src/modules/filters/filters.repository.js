'use strict';

/**
 * Data access for the dynamic filter registry.
 *
 * The listings module depends on `findEffectiveDefinitions` to validate incoming
 * attribute payloads; the filters module builds its facet endpoints on top of the
 * same definitions.
 */

const db = require('../../utils/db');

const DEFINITION_COLUMNS = `
  fd.id,
  fd.category_id   AS "categoryId",
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
`;

/**
 * Every filter a category exposes: its own definitions plus those inherited from
 * its ancestors.
 *
 * This is the payoff of the materialized path - inheritance is a prefix join
 * inside the `category_effective_filters` view, not a recursive walk.
 *
 * @param {string} categoryId
 * @returns {Promise<object[]>}
 */
async function findEffectiveDefinitions(categoryId) {
  const { rows } = await db.query(
    `SELECT definition_id AS id,
            key,
            label,
            type,
            source,
            column_name   AS "columnName",
            unit,
            options,
            min_value     AS "minValue",
            max_value     AS "maxValue",
            is_filterable AS "isFilterable",
            is_facetable  AS "isFacetable",
            sort_order    AS "sortOrder",
            is_own_definition AS "isOwnDefinition"
       FROM category_effective_filters
      WHERE category_id = $1
      ORDER BY sort_order ASC, label ASC`,
    [categoryId],
  );
  return rows;
}

/** Definitions declared directly on a category (no inheritance). */
async function findOwnDefinitions(categoryId, { filterableOnly = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${DEFINITION_COLUMNS}
       FROM filter_definitions fd
      WHERE fd.category_id = $1
        AND ($2::boolean = FALSE OR fd.is_filterable = TRUE)
      ORDER BY fd.sort_order ASC, fd.label ASC`,
    [categoryId, filterableOnly],
  );
  return rows;
}

async function findDefinitionById(id) {
  return db.queryOne(`SELECT ${DEFINITION_COLUMNS} FROM filter_definitions fd WHERE fd.id = $1`, [id]);
}

/** @returns {Promise<object|null>} */
async function findDefinitionByKey(categoryId, key) {
  return db.queryOne(
    `SELECT definition_id AS id, key, label, type, source, column_name AS "columnName", unit,
            options, min_value AS "minValue", max_value AS "maxValue",
            is_filterable AS "isFilterable", is_facetable AS "isFacetable", sort_order AS "sortOrder"
       FROM category_effective_filters
      WHERE category_id = $1 AND key = $2`,
    [categoryId, key],
  );
}

/** Create a definition. Used by the seed script and any future admin API. */
async function createDefinition({
  categoryId,
  key,
  label,
  type,
  source = 'column',
  columnName = null,
  unit = null,
  options = null,
  minValue = null,
  maxValue = null,
  isFilterable = true,
  isFacetable = true,
  sortOrder = 0,
}) {
  return db.queryOne(
    `INSERT INTO filter_definitions
       (category_id, key, label, type, source, column_name, unit, options,
        min_value, max_value, is_filterable, is_facetable, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (category_id, key) DO UPDATE
        SET label = EXCLUDED.label,
            type = EXCLUDED.type,
            source = EXCLUDED.source,
            column_name = EXCLUDED.column_name,
            unit = EXCLUDED.unit,
            options = EXCLUDED.options,
            min_value = EXCLUDED.min_value,
            max_value = EXCLUDED.max_value,
            is_filterable = EXCLUDED.is_filterable,
            is_facetable = EXCLUDED.is_facetable,
            sort_order = EXCLUDED.sort_order,
            updated_at = NOW()
     RETURNING id, category_id AS "categoryId", key, label, type, source,
               column_name AS "columnName", unit, options,
               min_value AS "minValue", max_value AS "maxValue",
               is_filterable AS "isFilterable", is_facetable AS "isFacetable",
               sort_order AS "sortOrder"`,
    [
      categoryId,
      key,
      label,
      type,
      source,
      columnName,
      unit,
      options ? JSON.stringify(options) : null,
      minValue,
      maxValue,
      isFilterable,
      isFacetable,
      sortOrder,
    ],
  );
}

async function countAll() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS total FROM filter_definitions');
  return rows[0].total;
}

module.exports = {
  DEFINITION_COLUMNS,
  findEffectiveDefinitions,
  findOwnDefinitions,
  findDefinitionById,
  findDefinitionByKey,
  createDefinition,
  countAll,
};

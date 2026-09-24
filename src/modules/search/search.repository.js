'use strict';

/**
 * Data access for autocomplete.
 *
 * Suggestions are drawn from the data itself rather than a static dictionary, so
 * the list only ever offers values that will actually return results - and each
 * one carries its listing count, which the UI can show.
 */

const db = require('../../utils/db');

/**
 * Columns that may be autocompleted. Whitelisted so the column name can be
 * interpolated safely.
 */
const SUGGESTABLE = {
  make: { column: 'make', label: 'Make' },
  model: { column: 'model', label: 'Model' },
  city: { column: 'location_city', label: 'City' },
};

/**
 * Rank suggestions for one column.
 *
 * Three matching strategies are combined because they fail in different ways:
 *
 *   ILIKE '%term%'   substring - what most people expect while typing. Backed by
 *                    the pg_trgm GIN index, so it stays fast.
 *   ILIKE 'term%'    prefix - used only for *ranking*, so "Toy" puts "Toyota"
 *                    above "Toyota-based" style matches further down.
 *   column % term    trigram similarity - absorbs typos ("Toyata").
 *
 * Ranking is prefix first, then popularity, then alphabetically, which keeps the
 * order stable across identical counts.
 *
 * @param {object} options
 * @param {string} options.column      Whitelisted column name
 * @param {string} options.term        Raw user input
 * @param {?string[]} options.categoryIds
 * @param {number} options.limit
 */
async function suggestColumn({ column, term, categoryIds = null, limit }) {
  const params = [`%${term}%`, `${term}%`, term];
  const conditions = [`l.status <> 'removed'`, `l.${column} IS NOT NULL`];

  if (categoryIds && categoryIds.length) {
    params.push(categoryIds);
    conditions.push(`l.category_id = ANY($${params.length}::uuid[])`);
  }

  params.push(limit);

  const { rows } = await db.query(
    `SELECT l.${column} AS value,
            COUNT(*)::int AS "listingCount",
            MAX(CASE WHEN l.${column} ILIKE $2 THEN 1 ELSE 0 END) AS "prefixMatch"
       FROM listings l
      WHERE ${conditions.join(' AND ')}
        AND (l.${column} ILIKE $1 OR l.${column} % $3)
      GROUP BY l.${column}
      ORDER BY "prefixMatch" DESC, "listingCount" DESC, l.${column} ASC
      LIMIT $${params.length}`,
    params,
  );

  return rows.map((row) => ({
    value: row.value,
    listingCount: row.listingCount,
    prefixMatch: row.prefixMatch === 1,
  }));
}

/**
 * Suggestions across several columns.
 *
 * @param {object} options
 * @param {string} options.term
 * @param {string[]} options.types   Which groups to compute
 * @param {?string[]} options.categoryIds
 * @param {number} options.limit     Max suggestions per group
 * @returns {Promise<Record<string, object[]>>}
 */
async function suggest(term, { types, categoryIds = null, limit = 8 }) {
  const wanted = types.filter((type) => SUGGESTABLE[type]);

  const results = await Promise.all(
    wanted.map(async (type) => [
      type,
      await suggestColumn({ column: SUGGESTABLE[type].column, term, categoryIds, limit }),
    ]),
  );

  return Object.fromEntries(results);
}

module.exports = { suggest, suggestColumn, SUGGESTABLE };

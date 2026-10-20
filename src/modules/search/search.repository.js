'use strict';

const db = require('../../utils/db');

const SUGGESTABLE = {
  make: { column: 'make', label: 'Make' },
  model: { column: 'model', label: 'Model' },
  city: { column: 'location_city', label: 'City' },
};

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

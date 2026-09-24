'use strict';

/**
 * Data access for the category tree.
 *
 * The materialized path lets most of these queries avoid recursion entirely.
 */

const db = require('../../utils/db');

const COLUMNS = `
  c.id,
  c.name,
  c.slug,
  c.parent_id    AS "parentId",
  c.path,
  c.depth,
  c.description,
  c.icon,
  c.sort_order   AS "sortOrder",
  c.is_active    AS "isActive",
  c.created_at   AS "createdAt",
  c.updated_at   AS "updatedAt"
`;

/**
 * Every category, ordered by materialized path.
 *
 * Ordering by `path` yields a depth-first traversal for free, so the service can
 * assemble the nested tree in a single pass without any recursive query.
 *
 * `listingCount` is the number of *directly* attached, visible listings - cheap
 * to compute with one aggregate join instead of a per-node subquery.
 */
async function findAll({ includeInactive = false, maxDepth = null } = {}) {
  const conditions = [];
  const params = [];

  if (!includeInactive) conditions.push('c.is_active = TRUE');
  if (maxDepth !== null) {
    params.push(maxDepth);
    conditions.push(`c.depth <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT ${COLUMNS},
            COALESCE(counts.total, 0)::int AS "listingCount"
       FROM categories c
       LEFT JOIN (
              SELECT category_id, COUNT(*) AS total
                FROM listings
               WHERE status <> 'removed'
               GROUP BY category_id
            ) counts ON counts.category_id = c.id
       ${where}
      ORDER BY c.path ASC`,
    params,
  );

  return rows;
}

async function findById(id) {
  return db.queryOne(`SELECT ${COLUMNS} FROM categories c WHERE c.id = $1`, [id]);
}

async function findByIdWithCounts(id) {
  return db.queryOne(
    `SELECT ${COLUMNS},
            COALESCE(counts.total, 0)::int AS "listingCount"
       FROM categories c
       LEFT JOIN (
              SELECT category_id, COUNT(*) AS total
                FROM listings
               WHERE status <> 'removed'
               GROUP BY category_id
            ) counts ON counts.category_id = c.id
      WHERE c.id = $1`,
    [id],
  );
}

async function findBySlug(slug, parentId = null) {
  return db.queryOne(
    `SELECT ${COLUMNS}
       FROM categories c
      WHERE c.slug = $1
        AND (($2::uuid IS NULL AND c.parent_id IS NULL) OR c.parent_id = $2::uuid)`,
    [slug, parentId],
  );
}

/** Direct children only. */
async function findChildren(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
       FROM categories c
      WHERE c.parent_id = $1
      ORDER BY c.sort_order ASC, c.name ASC`,
    [id],
  );
  return rows;
}

/**
 * The node and every descendant, via a single indexed prefix scan on `path`.
 *
 * This is the query the materialized path exists for: no recursive CTE, no
 * depth limit, one index range scan on `categories_path_prefix_idx`.
 */
async function findSubtree(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
       FROM categories c
      WHERE c.path LIKE (SELECT path FROM categories WHERE id = $1) || '%'
      ORDER BY c.path ASC`,
    [id],
  );
  return rows;
}

/** Ids of the node and all of its descendants - used to scope listing queries. */
async function findSubtreeIds(id) {
  const { rows } = await db.query(
    `SELECT c.id
       FROM categories c
      WHERE c.path LIKE (SELECT path FROM categories WHERE id = $1) || '%'`,
    [id],
  );
  return rows.map((row) => row.id);
}

/** Slugs that already exist under a given parent - used for slug de-duplication. */
async function findSiblingSlugs(parentId, prefix) {
  const { rows } = await db.query(
    `SELECT slug
       FROM categories
      WHERE (($1::uuid IS NULL AND parent_id IS NULL) OR parent_id = $1::uuid)
        AND slug LIKE $2 || '%'`,
    [parentId, prefix],
  );
  return rows.map((row) => row.slug);
}

/**
 * Insert a node. `path` and `depth` are filled in by the
 * `categories_assign_path_trigger` BEFORE INSERT trigger, so they are not
 * passed here - one less thing that can disagree with reality.
 */
async function create({ name, slug, parentId = null, description = null, icon = null, sortOrder = 0, isActive = true }) {
  return db.queryOne(
    `INSERT INTO categories (name, slug, parent_id, description, icon, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, slug, parent_id AS "parentId", path, depth,
               description, icon, sort_order AS "sortOrder", is_active AS "isActive",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [name, slug, parentId, description, icon, sortOrder, isActive],
  );
}

/**
 * Partial update using COALESCE so only the supplied fields change.
 * @returns {Promise<object|null>}
 */
async function update(id, fields) {
  return db.queryOne(
    `UPDATE categories
        SET name        = COALESCE($2, name),
            slug        = COALESCE($3, slug),
            description = COALESCE($4, description),
            icon        = COALESCE($5, icon),
            sort_order  = COALESCE($6, sort_order),
            is_active   = COALESCE($7, is_active)
      WHERE id = $1
      RETURNING id, name, slug, parent_id AS "parentId", path, depth,
                description, icon, sort_order AS "sortOrder", is_active AS "isActive",
                created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      id,
      fields.name ?? null,
      fields.slug ?? null,
      fields.description ?? null,
      fields.icon ?? null,
      fields.sortOrder ?? null,
      fields.isActive ?? null,
    ],
  );
}

/**
 * Reparent a node and rewrite its whole subtree, atomically.
 *
 * Runs inside a transaction and locks the moved node so a concurrent move
 * cannot interleave. The descendant rewrite is a single set-based UPDATE that
 * preserves each descendant's suffix while swapping the prefix - see
 * `categories_rebuild_subtree_paths` in migration 003.
 *
 * @returns {Promise<{ node: object|null, descendantsUpdated: number }>}
 */
async function move(id, newParentId) {
  return db.withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      'SELECT id, path, depth, parent_id AS "parentId" FROM categories WHERE id = $1 FOR UPDATE',
      [id],
    );
    const current = currentRows[0];
    if (!current) return { node: null, descendantsUpdated: 0 };

    let newPath;
    let newDepth;

    if (newParentId === null) {
      newPath = `/${id}/`;
      newDepth = 0;
    } else {
      const { rows: parentRows } = await client.query(
        'SELECT id, path, depth FROM categories WHERE id = $1',
        [newParentId],
      );
      const parent = parentRows[0];
      if (!parent) {
        const error = new Error('Parent category does not exist');
        error.code = '23503';
        throw error;
      }

      newPath = `${parent.path}${id}/`;
      newDepth = parent.depth + 1;
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE categories
          SET parent_id = $2,
              path      = $3,
              depth     = $4
        WHERE id = $1
        RETURNING id, name, slug, parent_id AS "parentId", path, depth,
                  description, icon, sort_order AS "sortOrder", is_active AS "isActive",
                  created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, newParentId, newPath, newDepth],
    );

    const { rows: rebuiltRows } = await client.query(
      'SELECT categories_rebuild_subtree_paths($1, $2, $3, $4, $5) AS affected',
      [id, current.path, current.depth, newPath, newDepth],
    );

    return {
      node: updatedRows[0],
      descendantsUpdated: rebuiltRows[0]?.affected ?? 0,
    };
  });
}

/**
 * Hard delete.
 *
 * `listings.category_id` is ON DELETE RESTRICT, so PostgreSQL refuses to delete
 * a category that still has listings and the API surfaces that as a 409 rather
 * than silently orphaning data. Descendant categories cascade.
 *
 * @returns {Promise<{ id: string }|null>}
 */
async function remove(id) {
  return db.queryOne('DELETE FROM categories WHERE id = $1 RETURNING id', [id]);
}

async function countAll() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS total FROM categories');
  return rows[0].total;
}

module.exports = {
  COLUMNS,
  findAll,
  findById,
  findByIdWithCounts,
  findBySlug,
  findChildren,
  findSubtree,
  findSubtreeIds,
  findSiblingSlugs,
  create,
  update,
  move,
  remove,
  countAll,
};

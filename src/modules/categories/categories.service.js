'use strict';

/**
 * Category business logic.
 *
 * Owns the tree rules: how slugs are de-duplicated, how the nested response is
 * assembled, and which moves are illegal.
 */

const logger = require('../../utils/logger');
const cache = require('../../utils/cache');
const { slugify } = require('../../utils/helpers');
const { NotFoundError, BadRequestError, ConflictError } = require('../../utils/errors');
const repository = require('./categories.repository');
const filtersRepository = require('../filters/filters.repository');

/**
 * Turn a flat, path-ordered list into a nested tree.
 *
 * Because the input is ordered by materialized path it is already in depth-first
 * order, so a single pass with an id -> node map is enough. No recursion, no
 * N+1 queries.
 *
 * @param {object[]} rows
 * @returns {object[]} root nodes, each with a `children` array
 */
function buildTree(rows) {
  const byId = new Map();
  const roots = [];

  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }

  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      // Either a genuine root, or a child whose parent was filtered out by
      // maxDepth / includeInactive - surface it rather than dropping it.
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Derive a slug that is unique among its siblings.
 *
 * Sibling-scoped rather than globally unique on purpose: "SUV" may legitimately
 * exist under both Cars and Motorcycles.
 */
async function resolveUniqueSlug(name, requestedSlug, parentId, excludeId = null) {
  const base = requestedSlug || slugify(name);
  if (!base) {
    throw new BadRequestError('Unable to derive a slug from the provided name');
  }

  const taken = new Set(await repository.findSiblingSlugs(parentId, base));
  if (excludeId) {
    // A node keeping its own slug is not a conflict.
    const existing = await repository.findById(excludeId);
    if (existing?.slug === base) taken.delete(base);
  }

  if (!taken.has(base)) return base;

  // Suffix with -2, -3, ... until free.
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new ConflictError(`Unable to derive a unique slug from "${base}"`);
}

/** Ensure the referenced parent exists (and is not the node itself). */
async function assertParentExists(parentId, selfId = null) {
  if (parentId === null || parentId === undefined) return null;

  if (selfId && parentId === selfId) {
    throw new BadRequestError('A category cannot be its own parent');
  }

  const parent = await repository.findById(parentId);
  if (!parent) throw new NotFoundError('Parent category');
  return parent;
}

/**
 * Full tree.
 * @returns {Promise<object[]>}
 */
async function getTree({ includeInactive = false, maxDepth = null, flat = false } = {}) {
  const rows = await repository.findAll({ includeInactive, maxDepth });
  return flat ? rows : buildTree(rows);
}

/** A single category plus its direct children and the filters it exposes. */
async function getById(id) {
  const category = await repository.findByIdWithCounts(id);
  if (!category) throw new NotFoundError('Category');

  const [children, effectiveFilters] = await Promise.all([
    repository.findChildren(id),
    // Own definitions plus everything inherited from ancestors - resolved by a
    // path-prefix join, not a recursive walk.
    filtersRepository.findEffectiveDefinitions(id),
  ]);

  return { ...category, children, effectiveFilters };
}

/**
 * Create a node.
 *
 * The slug is resolved before the insert; the unique partial indexes on
 * (parent_id, slug) remain the real guard against races.
 */
async function createCategory(input) {
  await assertParentExists(input.parentId ?? null);

  const slug = await resolveUniqueSlug(input.name, input.slug, input.parentId ?? null);

  try {
    const category = await repository.create({
      name: input.name,
      slug,
      parentId: input.parentId ?? null,
      description: input.description ?? null,
      icon: input.icon ?? null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    });

    logger.info('Category created', { categoryId: category.id, slug: category.slug, depth: category.depth });
    // The tree is part of every cached filter response.
    await cache.invalidateCatalog();
    return category;
  } catch (error) {
    if (error.code === '23505') {
      throw new ConflictError('A category with this slug already exists under the same parent', {
        field: 'slug',
      });
    }
    throw error;
  }
}

/**
 * Update a node's own fields.
 *
 * `parentId` is deliberately not handled here - moving a node has subtree-wide
 * consequences, so it goes through `moveCategory`.
 */
async function updateCategory(id, input) {
  const existing = await repository.findById(id);
  if (!existing) throw new NotFoundError('Category');

  const fields = { ...input };

  if (fields.slug && fields.slug !== existing.slug) {
    fields.slug = await resolveUniqueSlug(fields.name || existing.name, fields.slug, existing.parentId, id);
  } else if (!fields.slug) {
    delete fields.slug; // keep the existing slug when only the name changes
  }

  const category = await repository.update(id, fields);
  if (!category) throw new NotFoundError('Category');

  logger.info('Category updated', { categoryId: id });
  await cache.invalidateCatalog();
  return category;
}

/**
 * Reparent a node.
 *
 * Two rules protect the tree:
 *   1. The new parent must exist and must not be the node itself.
 *   2. The new parent must not sit inside the node's own subtree - otherwise the
 *      subtree would be detached from the root and the path invariant broken.
 */
async function moveCategory(id, newParentId) {
  const node = await repository.findById(id);
  if (!node) throw new NotFoundError('Category');

  const normalisedParentId = newParentId ?? null;

  if (normalisedParentId === id) {
    throw new BadRequestError('A category cannot be its own parent');
  }

  if (normalisedParentId !== null) {
    const parent = await assertParentExists(normalisedParentId);

    // `path` ends with '/', so a descendant's path starts with the node's path.
    if (parent.path.startsWith(node.path)) {
      throw new BadRequestError(
        'Cannot move a category into its own descendant - that would detach the subtree',
        { categoryId: id, attemptedParentId: normalisedParentId },
      );
    }
  }

  const { node: moved, descendantsUpdated } = await repository.move(id, normalisedParentId);
  if (!moved) throw new NotFoundError('Category');

  logger.info('Category moved', { categoryId: id, newParentId: normalisedParentId, descendantsUpdated });
  // A move rewrites the materialized paths, so cached facet scopes are stale.
  await cache.invalidateCatalog();

  return { ...moved, descendantsUpdated };
}

/**
 * Delete a category.
 * Fails with a 409 (via the FK RESTRICT) when listings still reference it.
 */
async function deleteCategory(id) {
  const node = await repository.findById(id);
  if (!node) throw new NotFoundError('Category');

  const deleted = await repository.remove(id);
  if (!deleted) throw new NotFoundError('Category');

  logger.info('Category deleted', { categoryId: id });
  await cache.invalidateCatalog();
  return { id };
}

/** Ids of a category and all descendants - the scope for category browsing. */
async function getSubtreeIds(id) {
  const node = await repository.findById(id);
  if (!node) throw new NotFoundError('Category');
  return repository.findSubtreeIds(id);
}

module.exports = {
  buildTree,
  getTree,
  getById,
  createCategory,
  updateCategory,
  moveCategory,
  deleteCategory,
  getSubtreeIds,
  resolveUniqueSlug,
};

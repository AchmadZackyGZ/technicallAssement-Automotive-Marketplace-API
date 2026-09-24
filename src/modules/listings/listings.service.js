'use strict';

/**
 * Listing business logic.
 *
 * The interesting part is `resolveAttributes`: a client may send any key that a
 * filter definition declares for the listing's category, and the service routes
 * each value to the right place - a first-class column or an EAV row - after
 * validating it against the definition's declared type.
 *
 * That is what makes the filter architecture dynamic: adding `battery_capacity_kwh`
 * to Electric vehicles is an INSERT into `filter_definitions`, and listings can
 * immediately accept and store it.
 */

const logger = require('../../utils/logger');
const { NotFoundError, BadRequestError, ValidationError } = require('../../utils/errors');
const { decodeCursor, normaliseLimit, buildPage } = require('../../utils/pagination');
const categoriesRepository = require('../categories/categories.repository');
const filtersRepository = require('../filters/filters.repository');
const repository = require('./listings.repository');

/** Core fields a client may supply at the top level. */
const CORE_FIELDS = [
  'title',
  'description',
  'make',
  'model',
  'year',
  'mileageKm',
  'price',
  'condition',
  'transmission',
  'fuelType',
  'color',
  'locationCity',
  'locationProvince',
  'status',
  'isFeatured',
  'categoryId',
];

/** Keep only the keys that are actually present, so PATCH semantics stay partial. */
function pickCoreFields(input) {
  const picked = {};
  for (const field of CORE_FIELDS) {
    if (input[field] !== undefined) picked[field] = input[field];
  }
  return picked;
}

/** Coerce the loose truthy values a query string or JSON body can carry. */
function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * Validate the `attributes` map against the category's filter definitions and
 * split it into column writes and EAV rows.
 *
 * @param {string} categoryId
 * @param {Object<string, string|number|boolean|null>} attributes
 * @returns {Promise<{ columnFields: object, attributeRows: object[], removeAttributeIds: string[] }>}
 * @throws {ValidationError} when a key is unknown or a value breaks its definition
 */
async function resolveAttributes(categoryId, attributes = {}) {
  const entries = Object.entries(attributes).filter(([, value]) => value !== undefined);
  const empty = { columnFields: {}, attributeRows: [], removeAttributeIds: [] };
  if (!entries.length) return empty;

  const definitions = await filtersRepository.findEffectiveDefinitions(categoryId);
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  const columnFields = {};
  const attributeRows = [];
  const removeAttributeIds = [];
  const errors = [];

  for (const [key, rawValue] of entries) {
    const definition = byKey.get(key);

    if (!definition) {
      errors.push({
        field: `attributes.${key}`,
        message: `"${key}" is not a filter attribute of this category`,
        code: 'unknown_attribute',
        allowed: [...byKey.keys()],
      });
      continue;
    }

    // `null` clears the value.
    if (rawValue === null) {
      if (definition.source === 'column') {
        columnFields[repository.COLUMN_TO_FIELD[definition.columnName]] = null;
      } else {
        removeAttributeIds.push(definition.id);
      }
      continue;
    }

    let value;

    if (definition.type === 'enum') {
      const allowed = (definition.options ?? []).map((option) => option.value);
      const candidate = String(rawValue);
      if (allowed.length && !allowed.includes(candidate)) {
        errors.push({
          field: `attributes.${key}`,
          message: `"${candidate}" is not one of the allowed values: ${allowed.join(', ')}`,
          code: 'invalid_enum_value',
        });
        continue;
      }
      value = candidate;
    } else if (definition.type === 'range') {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) {
        errors.push({
          field: `attributes.${key}`,
          message: 'Must be a number',
          code: 'invalid_type',
        });
        continue;
      }
      const min = definition.minValue === null ? -Infinity : Number(definition.minValue);
      const max = definition.maxValue === null ? Infinity : Number(definition.maxValue);
      if (numeric < min || numeric > max) {
        errors.push({
          field: `attributes.${key}`,
          message: `Must be between ${min} and ${max}${definition.unit ? ` ${definition.unit}` : ''}`,
          code: 'out_of_range',
        });
        continue;
      }
      value = numeric;
    } else {
      // boolean
      value = toBoolean(rawValue);
    }

    if (definition.source === 'column') {
      const field = repository.COLUMN_TO_FIELD[definition.columnName];
      if (!field) {
        errors.push({
          field: `attributes.${key}`,
          message: `Filter definition points at an unsupported column "${definition.columnName}"`,
          code: 'misconfigured_definition',
        });
        continue;
      }
      columnFields[field] = value;
    } else if (definition.type === 'range') {
      attributeRows.push({ definitionId: definition.id, valueNum: value });
    } else if (definition.type === 'boolean') {
      attributeRows.push({ definitionId: definition.id, valueBool: value });
    } else {
      attributeRows.push({ definitionId: definition.id, valueText: value });
    }
  }

  if (errors.length) {
    throw new ValidationError('One or more filter attributes are invalid', errors);
  }

  return { columnFields, attributeRows, removeAttributeIds };
}

/** Ensure the target category exists and is usable. */
async function assertCategoryUsable(categoryId) {
  const category = await categoriesRepository.findById(categoryId);
  if (!category) throw new NotFoundError('Category');
  if (!category.isActive) {
    throw new BadRequestError('The selected category is not active', { categoryId });
  }
  return category;
}

/**
 * Create a listing owned by `sellerId`.
 *
 * Explicit top-level fields win over attribute-derived ones, so sending both
 * `fuelType: "diesel"` and `attributes: { fuel_type: "petrol" }` is resolved in
 * favour of the explicit field rather than silently ambiguous.
 */
async function createListing(sellerId, input) {
  await assertCategoryUsable(input.categoryId);

  const { columnFields, attributeRows } = await resolveAttributes(input.categoryId, input.attributes);

  const listing = await repository.createWithRelations({
    listing: {
      sellerId,
      categoryId: input.categoryId,
      ...columnFields,
      ...pickCoreFields(input),
    },
    images: input.images ?? [],
    attributes: attributeRows,
  });

  logger.info('Listing created', {
    listingId: listing.id,
    sellerId,
    categoryId: listing.categoryId,
    attributes: attributeRows.length,
  });

  return repository.findByIdWithDetails(listing.id, { includeRemoved: true });
}

/**
 * Public listing detail. Bumps the view counter as a side effect.
 */
async function getListing(id, { includeRemoved = false } = {}) {
  const listing = await repository.findByIdWithDetails(id, { includeRemoved });
  if (!listing) throw new NotFoundError('Listing');

  await repository.incrementViewCount(id);
  listing.viewCount += 1;

  return listing;
}

/**
 * Partial update.
 *
 * Changing a listing's category invalidates its existing attributes (they belong
 * to the old category's definitions), so the whole attribute set is cleared and
 * rebuilt from whatever the request supplies.
 */
async function updateListing(id, input) {
  const existing = await repository.findById(id, { includeRemoved: true });
  if (!existing) throw new NotFoundError('Listing');

  const categoryChanged = input.categoryId !== undefined && input.categoryId !== existing.categoryId;
  const effectiveCategoryId = categoryChanged ? input.categoryId : existing.categoryId;

  if (categoryChanged) await assertCategoryUsable(input.categoryId);

  const { columnFields, attributeRows, removeAttributeIds } = await resolveAttributes(
    effectiveCategoryId,
    input.attributes ?? {},
  );

  const fields = { ...columnFields, ...pickCoreFields(input) };

  if (categoryChanged) {
    // Drop every attribute that belonged to the previous category.
    const stale = await repository.findAttributes(id);
    const staleIds = await resolveDefinitionIds(stale, existing.categoryId);
    removeAttributeIds.push(...staleIds);
  }

  const listing = await repository.updateWithRelations(id, {
    fields,
    images: input.images ?? null,
    attributes: attributeRows,
    removeAttributeIds,
  });

  if (!listing) throw new NotFoundError('Listing');

  logger.info('Listing updated', { listingId: id, categoryChanged });
  return repository.findByIdWithDetails(id, { includeRemoved: true });
}

/**
 * Resolve definition ids for attribute rows that came back hydrated (key/type,
 * no id). Only needed on the rare category-change path.
 */
async function resolveDefinitionIds(hydratedAttributes, categoryId) {
  if (!hydratedAttributes.length) return [];

  const definitions = await filtersRepository.findEffectiveDefinitions(categoryId);
  const idsByKey = new Map(definitions.map((definition) => [definition.key, definition.id]));

  return hydratedAttributes.map((attribute) => idsByKey.get(attribute.key)).filter(Boolean);
}

/**
 * Soft delete: `status` becomes `removed` and `deleted_at` is stamped.
 * The row stays for referential integrity and audit.
 */
async function deleteListing(id) {
  const existing = await repository.findById(id, { includeRemoved: true });
  if (!existing) throw new NotFoundError('Listing');

  if (existing.status === 'removed') {
    return { alreadyRemoved: true, listing: existing };
  }

  const listing = await repository.softDelete(id);
  logger.info('Listing soft-deleted', { listingId: id });

  return { alreadyRemoved: false, listing: listing ?? existing };
}

/**
 * Resolve the category scope for a browse/search request.
 *
 * When a category is named, `includeSubcategories` (default true) expands it to
 * the whole subtree via the materialized path, so browsing "Cars" naturally
 * returns "Cars > SUV" listings too.
 *
 * @returns {Promise<?string[]>} category ids, or null when unscoped
 */
async function resolveCategoryScope({ categoryId, categorySlug, includeSubcategories = true }) {
  if (!categoryId && !categorySlug) return null;

  const category = categoryId
    ? await categoriesRepository.findById(categoryId)
    : await categoriesRepository.findBySlug(categorySlug);

  if (!category) throw new NotFoundError('Category');

  return includeSubcategories ? categoriesRepository.findSubtreeIds(category.id) : [category.id];
}

/**
 * Browse listings: structured filters, sorting and cursor pagination.
 *
 * @param {object} input Validated browse query
 * @returns {Promise<{ items: object[], pagination: object }>}
 */
async function browseListings(input) {
  const categoryIds = await resolveCategoryScope(input);

  // `relevance` needs a full-text query to rank against; without one, fall back
  // to the default ordering rather than returning an arbitrary order.
  const sort = input.sort === 'relevance' && !input.q ? 'newest' : input.sort;

  const cursor = decodeCursor(input.cursor, sort);
  const limit = normaliseLimit(input.limit);

  const { rows, sortKey } = await repository.browse({
    input: { ...input, sort },
    categoryIds,
    cursor,
    limit,
  });

  const page = buildPage(rows, limit, sortKey);

  return {
    items: page.items.map(stripInternalFields),
    pagination: page.pagination,
  };
}

/**
 * Listings scoped to a category and its subcategories - the
 * `GET /categories/:id/listings` endpoint. It is browse with the category
 * pinned, so both endpoints share one code path.
 */
async function browseCategoryListings(categoryId, input) {
  const category = await categoriesRepository.findById(categoryId);
  if (!category) throw new NotFoundError('Category');

  const result = await browseListings({
    ...input,
    categoryId,
    categorySlug: undefined,
    includeSubcategories: input.includeSubcategories ?? true,
  });

  return { ...result, category: { id: category.id, name: category.name, slug: category.slug, depth: category.depth } };
}

/** Drop fields that exist only to drive keyset pagination. */
function stripInternalFields(row) {
  const { rank, ...rest } = row;
  return rest;
}

module.exports = {
  createListing,
  getListing,
  updateListing,
  deleteListing,
  browseListings,
  browseCategoryListings,
  resolveCategoryScope,
  resolveAttributes,
  pickCoreFields,
};

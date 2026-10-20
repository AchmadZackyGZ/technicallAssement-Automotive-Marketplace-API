'use strict';

const logger = require('../../utils/logger');
const cache = require('../../utils/cache');
const { NotFoundError, BadRequestError, ValidationError } = require('../../utils/errors');
const { decodeCursor, normaliseLimit, buildPage } = require('../../utils/pagination');
const categoriesRepository = require('../categories/categories.repository');
const filtersRepository = require('../filters/filters.repository');
const repository = require('./listings.repository');

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

function pickCoreFields(input) {
  const picked = {};
  for (const field of CORE_FIELDS) {
    if (input[field] !== undefined) picked[field] = input[field];
  }
  return picked;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

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

async function assertCategoryUsable(categoryId) {
  const category = await categoriesRepository.findById(categoryId);
  if (!category) throw new NotFoundError('Category');
  if (!category.isActive) {
    throw new BadRequestError('The selected category is not active', { categoryId });
  }
  return category;
}

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

  await cache.invalidateCatalog();

  return repository.findByIdWithDetails(listing.id, { includeRemoved: true });
}

async function getListing(id, { includeRemoved = false } = {}) {
  const listing = await repository.findByIdWithDetails(id, { includeRemoved });
  if (!listing) throw new NotFoundError('Listing');

  await repository.incrementViewCount(id);
  listing.viewCount += 1;

  return listing;
}

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
  await cache.invalidateCatalog();

  return repository.findByIdWithDetails(id, { includeRemoved: true });
}

async function resolveDefinitionIds(hydratedAttributes, categoryId) {
  if (!hydratedAttributes.length) return [];

  const definitions = await filtersRepository.findEffectiveDefinitions(categoryId);
  const idsByKey = new Map(definitions.map((definition) => [definition.key, definition.id]));

  return hydratedAttributes.map((attribute) => idsByKey.get(attribute.key)).filter(Boolean);
}

async function deleteListing(id) {
  const existing = await repository.findById(id, { includeRemoved: true });
  if (!existing) throw new NotFoundError('Listing');

  if (existing.status === 'removed') {
    return { alreadyRemoved: true, listing: existing };
  }

  const listing = await repository.softDelete(id);
  logger.info('Listing soft-deleted', { listingId: id });

  await cache.invalidateCatalog();

  return { alreadyRemoved: false, listing: listing ?? existing };
}

async function resolveCategoryScope({ categoryId, categorySlug, includeSubcategories = true }) {
  if (!categoryId && !categorySlug) return null;

  const category = categoryId
    ? await categoriesRepository.findById(categoryId)
    : await categoriesRepository.findBySlug(categorySlug);

  if (!category) throw new NotFoundError('Category');

  return includeSubcategories ? categoriesRepository.findSubtreeIds(category.id) : [category.id];
}

async function browseListings(input) {
  const categoryIds = await resolveCategoryScope(input);

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

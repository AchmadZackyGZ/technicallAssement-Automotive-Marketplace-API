'use strict';

/**
 * HTTP layer for filters and facets.
 */

const { asyncHandler } = require('../../utils/asyncHandler');
const { NotFoundError } = require('../../utils/errors');
const service = require('./filters.service');
const categoriesRepository = require('../categories/categories.repository');

/**
 * Shape the service output into the public response.
 * `cached` becomes an `X-Cache` header so the cache is observable from outside.
 */
function present(res, options) {
  res.set('X-Cache', options.cached ? 'HIT' : 'MISS');

  return {
    data: {
      scope: options.scope,
      definitions: options.definitions,
      facets: options.facets,
      ranges: options.ranges,
      totalMatching: options.totalMatching,
    },
  };
}

/** GET /filters - global filter options with counts. */
const list = asyncHandler(async (req, res) => {
  const options = await service.getFilterOptions(req.query, {});
  res.json(present(res, options));
});

/** GET /filters/:categoryId - the filter set a category exposes. */
const byCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;

  const category = await categoriesRepository.findById(categoryId);
  if (!category) throw new NotFoundError('Category');

  const options = await service.getFilterOptions(req.query, { scopeCategoryId: categoryId });

  res.json({
    ...present(res, options),
    meta: {
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
        path: category.path,
        depth: category.depth,
      },
    },
  });
});

module.exports = { list, byCategory };

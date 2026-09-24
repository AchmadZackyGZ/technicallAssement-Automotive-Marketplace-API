'use strict';

/**
 * Search business logic.
 *
 * Search deliberately does NOT re-implement filtering or counting. It delegates
 * to the same browse service and the same facet service the other endpoints use,
 * so "the same filters work in both places" holds by construction rather than by
 * discipline.
 *
 * Full-text matching itself lives in listings.query.js, where the tsvector
 * predicate is OR-ed with pg_trgm branches: the tsvector handles stemming and
 * word order, and the trigram branches handle partial words and typos that
 * full-text search cannot match because it works on whole lexemes.
 */

const logger = require('../../utils/logger');
const { browseListings, resolveCategoryScope } = require('../listings/listings.service');
const filtersService = require('../filters/filters.service');

/**
 * Full-text search with faceted counts.
 *
 * @param {object} input Validated search query
 * @returns {Promise<{ items: object[], pagination: object, query: ?string, facets: ?object }>}
 */
async function searchListings(input) {
  const { items, pagination } = await browseListings(input);

  const result = { items, pagination, query: input.q ?? null };
  if (input.facets === false) return result;

  // Facets describe the whole matching set, so the cursor, page size and sort
  // are stripped before counting: counts must not shift as the caller pages.
  const { cursor, limit, sort, facets, ...filterInput } = input;

  const scopeCategoryId = filterInput.categoryId ?? null;
  const categoryIds = await resolveCategoryScope(filterInput);

  result.facets = await filtersService.computeFacets(filterInput, {
    categoryIds,
    scopeCategoryId,
    facetKeys: input.facetKeys ?? null,
  });

  logger.debug('Search executed', {
    query: input.q ?? null,
    results: items.length,
    facetGroups: result.facets.groups.length,
  });

  return result;
}

module.exports = { searchListings };

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
const cache = require('../../utils/cache');
const { browseListings, resolveCategoryScope } = require('../listings/listings.service');
const filtersService = require('../filters/filters.service');
const repository = require('./search.repository');

/**
 * Full-text search with faceted counts.
 *
 * The whole response - rows, pagination and facets - is cached under a key
 * derived from the request, because the expensive part is the facet aggregation
 * and it depends only on the filters, never on the cursor.
 *
 * @param {object} input Validated search query
 * @returns {Promise<{ items: object[], pagination: object, query: ?string, facets: ?object, cached: boolean }>}
 */
async function searchListings(input) {
  const { value, cached } = await cache.remember('search', input, () => runSearch(input));
  return { ...value, cached };
}

async function runSearch(input) {
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

/**
 * Autocomplete for make, model and city.
 *
 * Values come from the data, so every suggestion is guaranteed to match at least
 * one listing, and each carries its count for the UI to display. Matching and
 * ranking are explained in search.repository.js.
 *
 * Suggestions are cached because a keystroke-driven endpoint is hit far more
 * often than the underlying data changes.
 *
 * @param {object} input Validated suggest query
 * @returns {Promise<{ query: string, suggestions: object, total: number, cached: boolean }>}
 */
async function suggest(input) {
  const { value, cached } = await cache.remember('suggest', input, () => runSuggest(input));
  return { ...value, cached };
}

async function runSuggest(input) {
  const term = input.q.trim();
  const types = input.types ?? ['make', 'model', 'city'];

  const categoryIds = await resolveCategoryScope(input);

  const suggestions = await repository.suggest(term, {
    types,
    categoryIds,
    limit: input.limit,
  });

  const total = Object.values(suggestions).reduce((sum, group) => sum + group.length, 0);

  logger.debug('Suggestions generated', { term, types, total });

  return { query: term, suggestions, total };
}

module.exports = { searchListings, suggest };

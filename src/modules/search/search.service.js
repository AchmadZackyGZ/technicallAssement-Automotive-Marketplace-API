'use strict';

const logger = require('../../utils/logger');
const cache = require('../../utils/cache');
const { browseListings, resolveCategoryScope } = require('../listings/listings.service');
const filtersService = require('../filters/filters.service');
const repository = require('./search.repository');

async function searchListings(input) {
  const { value, cached } = await cache.remember('search', input, () => runSearch(input));
  return { ...value, cached };
}

async function runSearch(input) {
  const { items, pagination } = await browseListings(input);

  const result = { items, pagination, query: input.q ?? null };
  if (input.facets === false) return result;

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

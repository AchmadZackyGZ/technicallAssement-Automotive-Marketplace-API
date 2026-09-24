'use strict';

/**
 * Search business logic.
 *
 * Search deliberately does NOT re-implement filtering. It delegates to the same
 * browse service the /listings endpoint uses, so "the same filters work in both
 * places" holds by construction rather than by discipline.
 *
 * Full-text matching itself lives in listings.query.js, where the tsvector
 * predicate is OR-ed with pg_trgm ILIKE branches: the tsvector handles stemming
 * and word order, and the trigram branches handle partial words and typos that
 * full-text search cannot match because it works on whole lexemes.
 */

const logger = require('../../utils/logger');
const { browseListings } = require('../listings/listings.service');

/**
 * Full-text search with every structured filter the browse endpoint supports.
 *
 * @param {object} input Validated search query
 * @returns {Promise<{ items: object[], pagination: object, query: ?string }>}
 */
async function searchListings(input) {
  const { items, pagination } = await browseListings(input);

  logger.debug('Search executed', {
    query: input.q ?? null,
    results: items.length,
    sort: pagination.sort,
  });

  return { items, pagination, query: input.q ?? null };
}

module.exports = { searchListings };

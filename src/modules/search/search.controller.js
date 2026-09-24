'use strict';

/**
 * HTTP layer for search.
 *
 * Cache status is surfaced as an `X-Cache` header so it is observable from the
 * outside - useful when demonstrating that the Redis layer is actually doing
 * something rather than merely configured.
 */

const { asyncHandler } = require('../../utils/asyncHandler');
const service = require('./search.service');

/** GET /listings/search */
const search = asyncHandler(async (req, res) => {
  const { items, pagination, query, facets, cached } = await service.searchListings(req.query);

  res.set('X-Cache', cached ? 'HIT' : 'MISS');

  const body = { data: items, pagination, meta: { query } };

  if (facets) {
    body.facets = {
      totalMatching: facets.counts.total,
      groups: facets.groups,
      ranges: facets.ranges,
    };
  }

  res.json(body);
});

/** GET /listings/search/suggest */
const suggest = asyncHandler(async (req, res) => {
  const { query, suggestions, total, cached } = await service.suggest(req.query);

  res.set('X-Cache', cached ? 'HIT' : 'MISS');
  res.json({
    data: { query, ...suggestions },
    meta: { total },
  });
});

module.exports = { search, suggest };

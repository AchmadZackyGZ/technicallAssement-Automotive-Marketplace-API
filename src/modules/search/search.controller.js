'use strict';

/**
 * HTTP layer for search.
 */

const { asyncHandler } = require('../../utils/asyncHandler');
const service = require('./search.service');

/** GET /listings/search */
const search = asyncHandler(async (req, res) => {
  const { items, pagination, query, facets } = await service.searchListings(req.query);

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
  const { query, suggestions, total } = await service.suggest(req.query);

  res.json({
    data: { query, ...suggestions },
    meta: { total },
  });
});

module.exports = { search, suggest };

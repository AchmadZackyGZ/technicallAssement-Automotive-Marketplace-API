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
  if (facets) body.facets = facets;

  res.json(body);
});

module.exports = { search };

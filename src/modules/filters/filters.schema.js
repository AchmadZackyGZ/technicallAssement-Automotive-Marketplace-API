'use strict';

/**
 * Filter/facet request contracts.
 *
 * The filter query is the browse query minus the pagination controls, plus the
 * two knobs that only make sense for facets. Deriving it from `browseQuery` means
 * every filter you can search by is also a filter you can ask for counts on -
 * the two cannot drift apart.
 */

const { z } = require('zod');

const { browseQuery } = require('../listings/listings.schema');

const facetKeys = z
  .string()
  .trim()
  .max(300)
  .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
  .optional();

const filterQuery = browseQuery.omit({ cursor: true, sort: true, limit: true }).extend({
  // How many values to return per categorical facet.
  valueLimit: z.coerce.number().int().min(1).max(100).default(20),
  // Restrict which facet groups are computed, e.g. ?facetKeys=make,city
  facetKeys,
});

const categoryIdParam = z.object({ categoryId: z.string().uuid('Must be a valid UUID') });

module.exports = {
  filterQuerySchema: { query: filterQuery },
  categoryFilterSchema: { query: filterQuery, params: categoryIdParam },
  filterQuery,
};

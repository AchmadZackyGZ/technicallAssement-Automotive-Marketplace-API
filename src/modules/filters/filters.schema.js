'use strict';

const { z } = require('zod');

const { browseQuery } = require('../listings/listings.schema');

const facetKeys = z
  .string()
  .trim()
  .max(300)
  .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
  .optional();

const filterQuery = browseQuery.omit({ cursor: true, sort: true, limit: true }).extend({
  valueLimit: z.coerce.number().int().min(1).max(100).default(20),
  facetKeys,
});

const categoryIdParam = z.object({ categoryId: z.string().uuid('Must be a valid UUID') });

module.exports = {
  filterQuerySchema: { query: filterQuery },
  categoryFilterSchema: { query: filterQuery, params: categoryIdParam },
  filterQuery,
};

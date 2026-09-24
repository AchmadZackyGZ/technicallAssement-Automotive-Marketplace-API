'use strict';

/**
 * Search request contracts.
 *
 * The search query is the browse query plus two switches, which keeps the two
 * endpoints honest: anything you can filter while browsing, you can filter while
 * searching.
 *
 *   fuzzy  - also match partial words and typos via pg_trgm (default true)
 *   facets - include facet counts for the whole matching set (default true)
 */

const { z } = require('zod');

const { browseQuery } = require('../listings/listings.schema');

const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => (typeof value === 'boolean' ? value : ['true', '1'].includes(value)));

const searchQuery = browseQuery.extend({
  fuzzy: boolQuery.default(true),
  facets: boolQuery.default(true),
  // Restrict which facet groups are computed, e.g. ?facetKeys=make,city
  facetKeys: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
    .optional(),
});

module.exports = { searchSchema: { query: searchQuery }, searchQuery };

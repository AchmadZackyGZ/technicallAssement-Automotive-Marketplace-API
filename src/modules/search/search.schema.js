'use strict';

/**
 * Search request contracts.
 *
 * The search query is the browse query plus three switches, which keeps the two
 * endpoints honest: anything you can filter while browsing, you can filter while
 * searching.
 *
 *   fuzzy  - also match partial words and typos via pg_trgm (default true)
 *   facets - include facet counts for the whole matching set (default true)
 *   facetKeys - restrict which facet groups are computed
 */

const { z } = require('zod');

const { browseQuery } = require('../listings/listings.schema');

const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => (typeof value === 'boolean' ? value : ['true', '1'].includes(value)));

const csv = (values) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : value.split(',')))
    .transform((items) => items.map((item) => item.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1));

const searchQuery = browseQuery.extend({
  fuzzy: boolQuery.default(true),
  facets: boolQuery.default(true),
  facetKeys: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
    .optional(),
});

/** Autocomplete. `q` is required here - there is nothing to suggest otherwise. */
const suggestQuery = z.object({
  q: z
    .string({ required_error: 'A search term is required' })
    .trim()
    .min(1, 'A search term is required')
    .max(80, 'Search term is too long'),
  types: csv(['make', 'model', 'city']).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(8),
  categoryId: z.string().uuid().optional(),
  categorySlug: z.string().trim().max(140).optional(),
  includeSubcategories: boolQuery.default(true),
});

module.exports = {
  searchSchema: { query: searchQuery },
  suggestSchema: { query: suggestQuery },
  searchQuery,
  suggestQuery,
};

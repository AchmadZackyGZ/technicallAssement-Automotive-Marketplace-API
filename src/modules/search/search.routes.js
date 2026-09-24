'use strict';

const express = require('express');

const controller = require('./search.controller');
const { searchSchema } = require('./search.schema');
const { validate } = require('../../middleware/validate');

const router = express.Router();

/**
 * @openapi
 * /listings/search:
 *   get:
 *     tags: [Search]
 *     summary: Full-text and faceted search with combined filters
 *     description: |
 *       Accepts the same filters, sorting and cursor pagination as GET /listings,
 *       and adds facet counts on top.
 *
 *       **How matching works.** Two complementary index strategies are OR-ed:
 *
 *       - a weighted `tsvector` (title/make/model ranked `A`, location and
 *         colour `B`, description `C`) queried with `websearch_to_tsquery`, which
 *         understands quoted phrases and `-exclusions` and never errors on odd
 *         input. This handles stemming and word order.
 *       - `pg_trgm` branches over title, make and model: `ILIKE '%q%'` for
 *         substrings ("avan" finds "Avanza") and the `%` similarity operator for
 *         typos ("Toyata" finds "Toyota"). Full-text search cannot do either,
 *         because it operates on whole lexemes. The similarity branches are
 *         applied to single-token queries only - against a multi-word phrase they
 *         would compare a phrase to a one-word column and match far too broadly.
 *
 *       Disable the trigram branches with `fuzzy=false` for strict matching.
 *
 *       **Facets** are computed from the same filter object with the cursor
 *       removed, so counts describe the whole matching set and do not shift as
 *       you page.
 *     parameters:
 *       - { in: query, name: q, schema: { type: string }, description: 'Search text, e.g. "toyota avanza 2019"' }
 *       - { in: query, name: fuzzy, schema: { type: boolean, default: true } }
 *       - { in: query, name: facets, schema: { type: boolean, default: true } }
 *       - { in: query, name: facetKeys, schema: { type: string }, description: 'Comma-separated facet groups to compute, e.g. make,city' }
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: includeSubcategories, schema: { type: boolean, default: true } }
 *       - { in: query, name: make, schema: { type: string } }
 *       - { in: query, name: condition, schema: { type: string } }
 *       - { in: query, name: transmission, schema: { type: string } }
 *       - { in: query, name: fuelType, schema: { type: string } }
 *       - { in: query, name: city, schema: { type: string } }
 *       - { in: query, name: yearMin, schema: { type: integer } }
 *       - { in: query, name: yearMax, schema: { type: integer } }
 *       - { in: query, name: priceMin, schema: { type: number } }
 *       - { in: query, name: priceMax, schema: { type: number } }
 *       - name: attr[engine_cc][min]
 *         in: query
 *         schema: { type: number }
 *         description: Dynamic range filter, keyed by a filter definition of the category.
 *       - $ref: '#/components/parameters/SortParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/CursorParam'
 *     responses:
 *       200:
 *         description: Matching listings plus facet counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Listing' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     query: { type: string, nullable: true, example: avanza }
 *                 facets: { $ref: '#/components/schemas/Facets' }
 *             example:
 *               data:
 *                 - id: 8f14e45f-ceea-467a-9c1c-1a2b3c4d5e6f
 *                   title: 2019 Toyota Avanza 1.5 G
 *                   make: Toyota
 *                   model: Avanza
 *                   year: 2019
 *                   price: 185000000
 *                   locationCity: Jakarta
 *               pagination: { limit: 20, count: 1, hasMore: false, sort: newest, nextCursor: null }
 *               meta: { query: avanza }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/', validate(searchSchema), controller.search);

module.exports = router;

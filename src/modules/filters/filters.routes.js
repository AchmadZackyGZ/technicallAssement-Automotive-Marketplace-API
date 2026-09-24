'use strict';

const express = require('express');

const controller = require('./filters.controller');
const { filterQuerySchema, categoryFilterSchema } = require('./filters.schema');
const { validate } = require('../../middleware/validate');

const router = express.Router();

/**
 * @openapi
 * /filters:
 *   get:
 *     tags: [Filters]
 *     summary: All available filter options with counts (facets)
 *     description: |
 *       Returns the filter options a client can offer, with counts.
 *
 *       **Disjunctive facets.** Each facet's counts are computed with that
 *       facet's own filter removed and every other filter still applied. After
 *       filtering to `make=Toyota` the make facet still lists Honda with its
 *       count, so the user can switch; the city facet only counts cities within
 *       Toyota.
 *
 *       Counts are produced from the same WHERE fragment as search results, so a
 *       facet can never disagree with the result set it describes.
 *
 *       The same query parameters as GET /listings are accepted, so a client can
 *       ask "what are the available options *given* my current filters?".
 *     parameters:
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: includeSubcategories, schema: { type: boolean, default: true } }
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: make, schema: { type: string } }
 *       - { in: query, name: city, schema: { type: string } }
 *       - { in: query, name: priceMin, schema: { type: number } }
 *       - { in: query, name: priceMax, schema: { type: number } }
 *       - { in: query, name: yearMin, schema: { type: integer } }
 *       - { in: query, name: yearMax, schema: { type: integer } }
 *       - { in: query, name: valueLimit, schema: { type: integer, default: 20 }, description: 'Max values per categorical facet' }
 *       - { in: query, name: facetKeys, schema: { type: string }, description: 'Comma-separated groups to compute, e.g. make,city' }
 *     responses:
 *       200:
 *         description: Filter options and facet counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     scope:
 *                       type: object
 *                       properties:
 *                         categoryId: { type: string, nullable: true }
 *                         includeSubcategories: { type: boolean }
 *                     definitions:
 *                       type: array
 *                       description: Filter registry entries (declared + inherited)
 *                       items: { $ref: '#/components/schemas/FilterDefinition' }
 *                     facets:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/FacetGroup' }
 *                     ranges:
 *                       type: object
 *                       additionalProperties: { $ref: '#/components/schemas/RangeFacet' }
 *                     totalMatching: { type: integer, example: 612 }
 *             example:
 *               data:
 *                 scope: { categoryId: null, includeSubcategories: true }
 *                 definitions: []
 *                 facets:
 *                   - key: make
 *                     label: Make
 *                     type: enum
 *                     values:
 *                       - { value: Toyota, count: 148 }
 *                       - { value: Honda, count: 96 }
 *                   - key: city
 *                     label: City
 *                     type: enum
 *                     values:
 *                       - { value: Jakarta, count: 210 }
 *                 ranges:
 *                   price:
 *                     key: price
 *                     label: Price
 *                     type: range
 *                     unit: IDR
 *                     min: 50000000
 *                     max: 2000000000
 *                     total: 612
 *                     buckets:
 *                       - { key: under_100m, label: 'Under Rp 100 jt', min: 0, max: 100000000, count: 84 }
 *                 totalMatching: 612
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/', validate(filterQuerySchema), controller.list);

/**
 * @openapi
 * /filters/{categoryId}:
 *   get:
 *     tags: [Filters]
 *     summary: Filter attributes specific to a category
 *     description: |
 *       Returns the filters a category exposes, including those **inherited from
 *       its ancestors**. Inheritance is resolved by a path-prefix join in the
 *       `category_effective_filters` view, so "Cars > SUV" automatically offers
 *       every filter declared on "Cars" without duplicating rows.
 *
 *       This is the endpoint that makes "fuel type appears under Cars but not
 *       Motorcycles" visible as data: the definitions are simply not inherited
 *       between siblings.
 *
 *       Facet counts are scoped to the category subtree and are disjunctive, as
 *       on GET /filters.
 *     parameters:
 *       - $ref: '#/components/parameters/CategoryId'
 *       - { in: query, name: includeSubcategories, schema: { type: boolean, default: true } }
 *       - { in: query, name: valueLimit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: facetKeys, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Category-scoped filter options
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     scope: { type: object }
 *                     definitions: { type: array, items: { $ref: '#/components/schemas/FilterDefinition' } }
 *                     facets: { type: array, items: { $ref: '#/components/schemas/FacetGroup' } }
 *                     ranges: { type: object, additionalProperties: { $ref: '#/components/schemas/RangeFacet' } }
 *                     totalMatching: { type: integer }
 *                 meta: { type: object }
 *             example:
 *               data:
 *                 scope: { categoryId: 6b1f3a2c-0000-4000-8000-000000000000, includeSubcategories: true }
 *                 definitions:
 *                   - key: fuel_type
 *                     label: Fuel Type
 *                     type: enum
 *                     source: column
 *                     options:
 *                       - { value: gasoline, label: Gasoline }
 *                       - { value: diesel, label: Diesel }
 *                   - key: engine_cc
 *                     label: Engine Displacement
 *                     type: range
 *                     source: attribute
 *                     unit: cc
 *                     minValue: 50
 *                     maxValue: 10000
 *                 facets: []
 *                 ranges: {}
 *                 totalMatching: 120
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/:categoryId', validate(categoryFilterSchema), controller.byCategory);

module.exports = router;

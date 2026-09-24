'use strict';

const express = require('express');

const controller = require('./listings.controller');
const repository = require('./listings.repository');
const { createSchema, updateSchema, idSchema, browseSchema } = require('./listings.schema');
const { validate } = require('../../middleware/validate');
const { authenticate, optionalAuth, requireOwnership } = require('../../middleware/auth');

const router = express.Router();

/**
 * Only the listing's owner (or an admin) may mutate it.
 * When the listing does not exist the guard steps aside so the handler can
 * answer with a 404 rather than a misleading 403.
 */
const mustOwnListing = requireOwnership((req) => repository.findOwnerId(req.params.id));

/**
 * @openapi
 * /listings:
 *   post:
 *     tags: [Listings]
 *     summary: Create a new vehicle listing
 *     description: |
 *       The authenticated user becomes the seller. `attributes` accepts any key
 *       declared as a filter definition for the chosen category - for example
 *       `engine_cc` under Cars, or `battery_capacity_kwh` under Electric.
 *       Values are validated against the definition's declared type, and a
 *       column-backed definition is routed to its column transparently.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [categoryId, title, make, model, year, price]
 *             properties:
 *               categoryId:       { type: string, format: uuid }
 *               title:            { type: string, example: '2019 Toyota Avanza 1.5 G - Full Service Record' }
 *               description:      { type: string, nullable: true }
 *               make:             { type: string, example: Toyota }
 *               model:            { type: string, example: Avanza }
 *               year:             { type: integer, example: 2019 }
 *               mileageKm:        { type: integer, example: 62000, default: 0 }
 *               price:            { type: number, example: 185000000 }
 *               condition:        { type: string, enum: [new, used, certified], default: used }
 *               transmission:     { type: string, enum: [manual, automatic, cvt], nullable: true }
 *               fuelType:         { type: string, enum: [gasoline, diesel, electric, hybrid], nullable: true }
 *               color:            { type: string, nullable: true, example: Silver }
 *               locationCity:     { type: string, nullable: true, example: Jakarta }
 *               locationProvince: { type: string, nullable: true, example: 'DKI Jakarta' }
 *               status:           { type: string, enum: [available, sold, pending], default: available }
 *               images:
 *                 type: array
 *                 maxItems: 20
 *                 items:
 *                   type: object
 *                   required: [url]
 *                   properties:
 *                     url:       { type: string, format: uri }
 *                     altText:   { type: string, nullable: true }
 *                     position:  { type: integer }
 *                     isPrimary: { type: boolean }
 *               attributes:
 *                 type: object
 *                 additionalProperties: true
 *                 example: { engine_cc: 1500, seat_count: 7, drive_type: FWD, has_sunroof: false }
 *           examples:
 *             car:
 *               summary: A car listing with dynamic attributes
 *               value:
 *                 categoryId: 3f1c9d2e-0000-4000-8000-000000000000
 *                 title: 2019 Toyota Avanza 1.5 G
 *                 make: Toyota
 *                 model: Avanza
 *                 year: 2019
 *                 mileageKm: 62000
 *                 price: 185000000
 *                 condition: used
 *                 transmission: automatic
 *                 fuelType: gasoline
 *                 color: Silver
 *                 locationCity: Jakarta
 *                 locationProvince: DKI Jakarta
 *                 images:
 *                   - url: https://images.example.com/avanza-1.jpg
 *                     isPrimary: true
 *                 attributes:
 *                   engine_cc: 1500
 *                   seat_count: 7
 *                   drive_type: FWD
 *     responses:
 *       201:
 *         description: Listing created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/ListingDetail' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/', authenticate, validate(createSchema), controller.create);

/**
 * @openapi
 * /listings:
 *   get:
 *     tags: [Listings]
 *     summary: Browse listings with filters, sorting and cursor pagination
 *     description: |
 *       Keyset (cursor) pagination, not offset pagination. Follow `nextCursor`
 *       until it is `null`.
 *
 *       Offset paging would force PostgreSQL to generate and discard every
 *       skipped row, and would shift results whenever a listing is inserted
 *       mid-pagination. A cursor encodes the position `(sortColumn, id)` and is
 *       answered by a composite index, so page 50 costs the same as page 1.
 *
 *       `id` is always the tie-breaker, so rows sharing a `created_at` cannot be
 *       duplicated or skipped across pages.
 *
 *       Dynamic attributes are filtered with `attr[key]=value` or
 *       `attr[key][min]=` / `attr[key][max]=`.
 *     parameters:
 *       - { in: query, name: q, schema: { type: string }, description: 'Full-text query' }
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: categorySlug, schema: { type: string }, description: 'Alternative to categoryId' }
 *       - { in: query, name: includeSubcategories, schema: { type: boolean, default: true } }
 *       - { in: query, name: make, schema: { type: string }, description: 'Comma-separated, exact values - see /filters for canonical values' }
 *       - { in: query, name: model, schema: { type: string } }
 *       - { in: query, name: condition, schema: { type: string, enum: [new, used, certified] } }
 *       - { in: query, name: transmission, schema: { type: string, enum: [manual, automatic, cvt] } }
 *       - { in: query, name: fuelType, schema: { type: string, enum: [gasoline, diesel, electric, hybrid] } }
 *       - { in: query, name: color, schema: { type: string } }
 *       - { in: query, name: city, schema: { type: string } }
 *       - { in: query, name: province, schema: { type: string } }
 *       - { in: query, name: yearMin, schema: { type: integer, example: 2018 } }
 *       - { in: query, name: yearMax, schema: { type: integer, example: 2024 } }
 *       - { in: query, name: priceMin, schema: { type: number, example: 100000000 } }
 *       - { in: query, name: priceMax, schema: { type: number, example: 500000000 } }
 *       - { in: query, name: mileageMax, schema: { type: integer, example: 100000 } }
 *       - { in: query, name: sellerId, schema: { type: string, format: uuid } }
 *       - { in: query, name: isFeatured, schema: { type: boolean } }
 *       - { in: query, name: status, schema: { type: string, description: 'Defaults to every status except "removed"' } }
 *       - name: attr[engine_cc][min]
 *         in: query
 *         schema: { type: number }
 *         description: Dynamic range filter. The key must be a filter definition of the category.
 *       - name: attr[drive_type]
 *         in: query
 *         schema: { type: string }
 *         description: Dynamic enum/boolean filter.
 *       - $ref: '#/components/parameters/SortParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/CursorParam'
 *     responses:
 *       200:
 *         description: A page of listings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Listing' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *             example:
 *               data:
 *                 - id: 8f14e45f-ceea-467a-9c1c-1a2b3c4d5e6f
 *                   title: 2019 Toyota Avanza 1.5 G
 *                   make: Toyota
 *                   model: Avanza
 *                   year: 2019
 *                   mileageKm: 62000
 *                   price: 185000000
 *                   currency: IDR
 *                   condition: used
 *                   transmission: automatic
 *                   fuelType: gasoline
 *                   color: Silver
 *                   status: available
 *                   locationCity: Jakarta
 *                   primaryImageUrl: https://images.example.com/avanza-1.jpg
 *               pagination:
 *                 limit: 20
 *                 count: 1
 *                 hasMore: false
 *                 sort: newest
 *                 nextCursor: null
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/', validate(browseSchema), controller.browse);

/**
 * @openapi
 * /listings/{id}:
 *   get:
 *     tags: [Listings]
 *     summary: Get a single listing
 *     description: |
 *       Returns the listing with its seller, category, image gallery and dynamic
 *       attributes. Increments `viewCount` as a side effect. Soft-deleted
 *       listings are only visible to an admin.
 *     parameters:
 *       - $ref: '#/components/parameters/ListingId'
 *     responses:
 *       200:
 *         description: Listing detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/ListingDetail' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Listings]
 *     summary: Update a listing
 *     description: |
 *       Partial update - only the supplied fields change. Only the owner (or an
 *       admin) may call this. Changing `categoryId` clears the attributes that
 *       belonged to the previous category. Supplying `images` replaces the whole
 *       gallery.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ListingId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:        { type: string }
 *               description:  { type: string, nullable: true }
 *               categoryId:   { type: string, format: uuid }
 *               make:         { type: string }
 *               model:        { type: string }
 *               year:         { type: integer }
 *               mileageKm:    { type: integer }
 *               price:        { type: number }
 *               condition:    { type: string, enum: [new, used, certified] }
 *               transmission: { type: string, enum: [manual, automatic, cvt], nullable: true }
 *               fuelType:     { type: string, enum: [gasoline, diesel, electric, hybrid], nullable: true }
 *               color:        { type: string, nullable: true }
 *               locationCity: { type: string, nullable: true }
 *               locationProvince: { type: string, nullable: true }
 *               status:       { type: string, enum: [available, sold, pending, removed] }
 *               isFeatured:   { type: boolean }
 *               images:       { type: array, items: { type: object } }
 *               attributes:   { type: object, additionalProperties: true }
 *     responses:
 *       200:
 *         description: Updated listing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/ListingDetail' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *   delete:
 *     tags: [Listings]
 *     summary: Soft-delete a listing
 *     description: |
 *       Sets `status` to `removed` and stamps `deleted_at`. The row is retained
 *       for referential integrity and audit, and disappears from all browse and
 *       search results.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ListingId'
 *     responses:
 *       200:
 *         description: Listing soft-deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/Listing' }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     softDeleted:    { type: boolean, example: true }
 *                     alreadyRemoved: { type: boolean, example: false }
 *                     message:        { type: string }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', optionalAuth, validate(idSchema), controller.getOne);
router.patch('/:id', authenticate, validate(updateSchema), mustOwnListing, controller.update);
router.delete('/:id', authenticate, validate(idSchema), mustOwnListing, controller.remove);

module.exports = router;

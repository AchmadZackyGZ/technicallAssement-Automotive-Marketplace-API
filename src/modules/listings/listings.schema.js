'use strict';

/**
 * Listing request contracts.
 *
 * Two kinds of input are accepted for a listing's characteristics:
 *
 *   1. Core columns (`make`, `year`, `price`, ...) - the attributes every
 *      vehicle has, so they are first-class fields with first-class validation.
 *
 *   2. `attributes` - a free-form map keyed by a *filter definition key*
 *      (`engine_cc`, `seat_count`, `has_sunroof`, ...). Which keys are legal
 *      depends on the listing's category, so they cannot be expressed in Zod.
 *      The service validates them against `filter_definitions`, and a
 *      column-backed definition is transparently routed to its column - meaning
 *      a client can send either `fuelType: "diesel"` or
 *      `attributes: { fuel_type: "diesel" }` and get the same result.
 */

const { z } = require('zod');

const { SORT_KEYS, DEFAULT_SORT, DEFAULT_LIMIT, MAX_LIMIT } = require('../../utils/pagination');

const uuid = z.string().uuid('Must be a valid UUID');

const CURRENT_YEAR = new Date().getFullYear();

const title = z
  .string({ required_error: 'Title is required' })
  .trim()
  .min(5, 'Title must be at least 5 characters')
  .max(200, 'Title must be at most 200 characters');

const make = z.string({ required_error: 'Make is required' }).trim().min(1).max(80);
const model = z.string({ required_error: 'Model is required' }).trim().min(1).max(80);

const year = z.coerce
  .number({ required_error: 'Year is required' })
  .int('Year must be a whole number')
  .min(1900, 'Year must be 1900 or later')
  // New models are usually announced a year ahead, so allow one future year.
  .max(CURRENT_YEAR + 1, `Year must be ${CURRENT_YEAR + 1} or earlier`);

const mileageKm = z.coerce.number().int('Mileage must be a whole number').min(0).max(2_000_000);

const price = z.coerce
  .number({ required_error: 'Price is required' })
  .min(0, 'Price cannot be negative')
  .max(999_999_999_999.99, 'Price is too large');

const condition = z.enum(['new', 'used', 'certified']);
const transmission = z.enum(['manual', 'automatic', 'cvt']);
const fuelType = z.enum(['gasoline', 'diesel', 'electric', 'hybrid']);
const status = z.enum(['available', 'sold', 'pending']);

const image = z.object({
  url: z.string().trim().url('Image URL must be a valid http(s) URL').max(2048),
  altText: z.string().trim().max(200).nullable().optional(),
  position: z.coerce.number().int().min(0).max(100).optional(),
  isPrimary: z.coerce.boolean().optional(),
});

/** Attribute values are validated against their filter definition, not here. */
const attributeValue = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);

const createBody = z.object({
  categoryId: uuid,
  title,
  description: z.string().trim().max(8000).nullable().optional(),
  make,
  model,
  year,
  mileageKm: mileageKm.optional().default(0),
  price,
  condition: condition.optional().default('used'),
  transmission: transmission.nullable().optional(),
  fuelType: fuelType.nullable().optional(),
  color: z.string().trim().max(40).nullable().optional(),
  locationCity: z.string().trim().max(80).nullable().optional(),
  locationProvince: z.string().trim().max(80).nullable().optional(),
  status: status.optional().default('available'),
  images: z.array(image).max(20, 'A listing can have at most 20 images').optional().default([]),
  attributes: z.record(attributeValue).optional().default({}),
});

const updateBody = z
  .object({
    categoryId: uuid.optional(),
    title: title.optional(),
    description: z.string().trim().max(8000).nullable().optional(),
    make: make.optional(),
    model: model.optional(),
    year: year.optional(),
    mileageKm: mileageKm.optional(),
    price: price.optional(),
    condition: condition.optional(),
    transmission: transmission.nullable().optional(),
    fuelType: fuelType.nullable().optional(),
    color: z.string().trim().max(40).nullable().optional(),
    locationCity: z.string().trim().max(80).nullable().optional(),
    locationProvince: z.string().trim().max(80).nullable().optional(),
    status: z.enum(['available', 'sold', 'pending', 'removed']).optional(),
    isFeatured: z.coerce.boolean().optional(),
    images: z.array(image).max(20).optional(),
    attributes: z.record(attributeValue).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

const idParam = z.object({ id: uuid });

// ---------------------------------------------------------------------------
// Browse / search query string
// ---------------------------------------------------------------------------

/** `?make=Toyota,Honda` -> ['Toyota', 'Honda']. */
const csvList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : value.split(',')))
  .transform((values) => values.map((item) => item.trim()).filter(Boolean))
  .refine((values) => values.length > 0, { message: 'Provide at least one value' });

/** Same, but restricted to a known set of values. */
const csvEnum = (values) =>
  csvList.pipe(
    z.array(z.enum(values)).min(1),
    { message: `Each value must be one of: ${values.join(', ')}` },
  );

const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => (typeof value === 'boolean' ? value : ['true', '1'].includes(value)));

/** `attr[engine_cc][min]=1000` or `attr[drive_type]=FWD`. */
const attrRange = z.object({
  min: z.coerce.number().optional(),
  max: z.coerce.number().optional(),
});
const attrFilterValue = z.union([attrRange, z.string().max(200), z.number(), z.boolean()]);

const browseQuery = z.object({
  q: z.string().trim().min(1).max(200).optional(),

  // When true (the default) the text query also matches partial words and typos
  // through pg_trgm, in addition to the full-text tsvector match.
  fuzzy: boolQuery.default(true),

  // Category scope. `includeSubcategories` defaults to true so browsing "Cars"
  // naturally includes "Cars > SUV".
  categoryId: uuid.optional(),
  categorySlug: z.string().trim().max(140).optional(),
  includeSubcategories: boolQuery.default(true),

  // Vehicle attributes.
  make: csvList.optional(),
  model: csvList.optional(),
  condition: csvEnum(['new', 'used', 'certified']).optional(),
  transmission: csvEnum(['manual', 'automatic', 'cvt']).optional(),
  fuelType: csvEnum(['gasoline', 'diesel', 'electric', 'hybrid']).optional(),
  color: csvList.optional(),

  // Location.
  city: csvList.optional(),
  province: z.string().trim().max(80).optional(),

  // Ranges.
  yearMin: z.coerce.number().int().min(1900).max(2100).optional(),
  yearMax: z.coerce.number().int().min(1900).max(2100).optional(),
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  mileageMax: z.coerce.number().int().min(0).optional(),

  // Ownership / visibility.
  sellerId: uuid.optional(),
  isFeatured: boolQuery.optional(),
  status: csvEnum(['available', 'sold', 'pending', 'removed']).optional(),

  // Dynamic, category-specific filters.
  attr: z.record(attrFilterValue).optional(),

  // Pagination.
  sort: z.enum(SORT_KEYS).default(DEFAULT_SORT),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().max(500).optional(),
});

module.exports = {
  createSchema: { body: createBody },
  updateSchema: { body: updateBody, params: idParam },
  idSchema: { params: idParam },
  browseSchema: { query: browseQuery },
  browseQuery,
  attributeValue,
  coreFields: { title, make, model, year, mileageKm, price, condition, transmission, fuelType, status },
};

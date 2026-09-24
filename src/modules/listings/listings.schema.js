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

module.exports = {
  createSchema: { body: createBody },
  updateSchema: { body: updateBody, params: idParam },
  idSchema: { params: idParam },
  attributeValue,
  coreFields: { title, make, model, year, mileageKm, price, condition, transmission, fuelType, status },
};

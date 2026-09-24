'use strict';

/**
 * Category request contracts.
 *
 * `slug` is optional everywhere: when omitted the service derives one from the
 * name. Clients may set it explicitly when they need a stable URL segment.
 */

const { z } = require('zod');

const uuid = z.string().uuid('Must be a valid UUID');

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Slug must be at least 2 characters')
  .max(140, 'Slug must be at most 140 characters')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug may only contain lowercase letters, numbers and single hyphens');

const name = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name must be at most 100 characters');

const createBody = z.object({
  name,
  slug: slug.optional(),
  // `null` explicitly creates a root category; omitting it does the same.
  parentId: uuid.nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  icon: z.string().trim().max(60).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  isActive: z.coerce.boolean().optional(),
});

const updateBody = z
  .object({
    name: name.optional(),
    slug: slug.optional(),
    parentId: uuid.nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    icon: z.string().trim().max(60).nullable().optional(),
    sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

const idParam = z.object({ id: uuid });

/**
 * `GET /categories` accepts a depth limit so the full tree can be trimmed for
 * lightweight clients, plus a flag to include inactive branches.
 */
const listQuery = z.object({
  maxDepth: z.coerce.number().int().min(0).max(20).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  flat: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

module.exports = {
  createSchema: { body: createBody },
  updateSchema: { body: updateBody, params: idParam },
  idSchema: { params: idParam },
  listSchema: { query: listQuery },
};

'use strict';

/**
 * HTTP layer for the category tree.
 */

const { asyncHandler } = require('../../utils/asyncHandler');
const service = require('./categories.service');

/** GET /categories */
const list = asyncHandler(async (req, res) => {
  const { includeInactive, maxDepth, flat } = req.query;
  const categories = await service.getTree({ includeInactive, maxDepth, flat });

  res.json({ data: categories, meta: { count: categories.length, flat } });
});

/** GET /categories/:id */
const getOne = asyncHandler(async (req, res) => {
  const category = await service.getById(req.params.id);
  res.json({ data: category });
});

/** POST /categories */
const create = asyncHandler(async (req, res) => {
  const category = await service.createCategory(req.body);
  res.status(201).json({ data: category });
});

/**
 * PATCH /categories/:id
 *
 * A `parentId` in the body is treated as a move, because that is what the caller
 * means and it needs the extra subtree handling.
 */
const update = asyncHandler(async (req, res) => {
  const { parentId, ...fields } = req.body;

  let category = Object.keys(fields).length
    ? await service.updateCategory(req.params.id, fields)
    : await service.getById(req.params.id);

  if (parentId !== undefined) {
    category = await service.moveCategory(req.params.id, parentId);
  }

  res.json({ data: category });
});

module.exports = { list, getOne, create, update };

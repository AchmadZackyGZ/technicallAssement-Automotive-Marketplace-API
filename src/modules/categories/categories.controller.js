'use strict';

const { asyncHandler } = require('../../utils/asyncHandler');
const service = require('./categories.service');
const listingsService = require('../listings/listings.service');

const list = asyncHandler(async (req, res) => {
  const { includeInactive, maxDepth, flat } = req.query;
  const categories = await service.getTree({ includeInactive, maxDepth, flat });

  res.json({ data: categories, meta: { count: categories.length, flat } });
});

const getOne = asyncHandler(async (req, res) => {
  const category = await service.getById(req.params.id);
  res.json({ data: category });
});

const create = asyncHandler(async (req, res) => {
  const category = await service.createCategory(req.body);
  res.status(201).json({ data: category });
});

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

const listListings = asyncHandler(async (req, res) => {
  const { items, pagination, category } = await listingsService.browseCategoryListings(
    req.params.id,
    req.query,
  );

  res.json({ data: items, pagination, meta: { category } });
});

module.exports = { list, getOne, create, update, listListings };

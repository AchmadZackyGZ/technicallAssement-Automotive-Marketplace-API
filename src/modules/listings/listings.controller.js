'use strict';

const { asyncHandler } = require('../../utils/asyncHandler');
const service = require('./listings.service');

const create = asyncHandler(async (req, res) => {
  const listing = await service.createListing(req.user.id, req.body);
  res.status(201).json({ data: listing });
});

const browse = asyncHandler(async (req, res) => {
  const { items, pagination } = await service.browseListings(req.query);
  res.json({ data: items, pagination });
});

const getOne = asyncHandler(async (req, res) => {
  const includeRemoved = req.user?.role === 'admin';
  const listing = await service.getListing(req.params.id, { includeRemoved });
  res.json({ data: listing });
});

const update = asyncHandler(async (req, res) => {
  const listing = await service.updateListing(req.params.id, req.body);
  res.json({ data: listing });
});

const remove = asyncHandler(async (req, res) => {
  const { alreadyRemoved, listing } = await service.deleteListing(req.params.id);

  res.json({
    data: listing,
    meta: {
      softDeleted: true,
      alreadyRemoved,
      message: alreadyRemoved
        ? 'Listing was already removed'
        : 'Listing removed (status set to "removed"); the record is retained for audit',
    },
  });
});

module.exports = { create, browse, getOne, update, remove };

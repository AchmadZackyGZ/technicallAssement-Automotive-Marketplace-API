'use strict';

/**
 * HTTP layer for listings.
 */

const { asyncHandler } = require('../../utils/asyncHandler');
const service = require('./listings.service');

/** POST /listings */
const create = asyncHandler(async (req, res) => {
  const listing = await service.createListing(req.user.id, req.body);
  res.status(201).json({ data: listing });
});

/** GET /listings */
const browse = asyncHandler(async (req, res) => {
  const { items, pagination } = await service.browseListings(req.query);
  res.json({ data: items, pagination });
});

/** GET /listings/:id */
const getOne = asyncHandler(async (req, res) => {
  // An owner or admin may still open a listing that was soft-deleted.
  const includeRemoved = req.user?.role === 'admin';
  const listing = await service.getListing(req.params.id, { includeRemoved });
  res.json({ data: listing });
});

/** PATCH /listings/:id */
const update = asyncHandler(async (req, res) => {
  const listing = await service.updateListing(req.params.id, req.body);
  res.json({ data: listing });
});

/** DELETE /listings/:id */
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

'use strict';

const express = require('express');

const controller = require('./listings.controller');
const repository = require('./listings.repository');
const { createSchema, updateSchema, idSchema, browseSchema } = require('./listings.schema');
const { validate } = require('../../middleware/validate');
const { authenticate, optionalAuth, requireOwnership } = require('../../middleware/auth');
const searchRoutes = require('../search/search.routes');

const router = express.Router();

router.use('/search', searchRoutes);

const mustOwnListing = requireOwnership((req) => repository.findOwnerId(req.params.id));

router.post('/', authenticate, validate(createSchema), controller.create);

router.get('/', validate(browseSchema), controller.browse);

router.get('/:id', optionalAuth, validate(idSchema), controller.getOne);
router.patch('/:id', authenticate, validate(updateSchema), mustOwnListing, controller.update);
router.delete('/:id', authenticate, validate(idSchema), mustOwnListing, controller.remove);

module.exports = router;

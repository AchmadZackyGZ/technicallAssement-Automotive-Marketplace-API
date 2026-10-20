'use strict';

const express = require('express');

const controller = require('./categories.controller');
const { createSchema, updateSchema, idSchema, listSchema } = require('./categories.schema');
const { browseQuery } = require('../listings/listings.schema');
const { validate } = require('../../middleware/validate');
const { authenticate, requireRole } = require('../../middleware/auth');

const router = express.Router();

router.get('/', validate(listSchema), controller.list);
router.post('/', authenticate, requireRole('admin'), validate(createSchema), controller.create);

router.get(
  '/:id/listings',
  validate({ params: idSchema.params, query: browseQuery }),
  controller.listListings,
);

router.get('/:id', validate(idSchema), controller.getOne);
router.patch('/:id', authenticate, requireRole('admin'), validate(updateSchema), controller.update);

module.exports = router;

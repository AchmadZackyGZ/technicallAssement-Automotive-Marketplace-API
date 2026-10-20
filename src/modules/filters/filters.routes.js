'use strict';

const express = require('express');

const controller = require('./filters.controller');
const { filterQuerySchema, categoryFilterSchema } = require('./filters.schema');
const { validate } = require('../../middleware/validate');

const router = express.Router();

router.get('/', validate(filterQuerySchema), controller.list);

router.get('/:categoryId', validate(categoryFilterSchema), controller.byCategory);

module.exports = router;

'use strict';

const express = require('express');

const controller = require('./search.controller');
const { searchSchema, suggestSchema } = require('./search.schema');
const { validate } = require('../../middleware/validate');

const router = express.Router();

router.get('/', validate(searchSchema), controller.search);

router.get('/suggest', validate(suggestSchema), controller.suggest);

module.exports = router;

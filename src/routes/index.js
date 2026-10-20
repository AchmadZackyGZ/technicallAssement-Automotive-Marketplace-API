'use strict';

const express = require('express');

const { health } = require('./health');
const authRoutes = require('../modules/auth/auth.routes');
const categoryRoutes = require('../modules/categories/categories.routes');
const listingRoutes = require('../modules/listings/listings.routes');
const filterRoutes = require('../modules/filters/filters.routes');

const router = express.Router();

router.get('/health', health);

router.use('/auth', authRoutes);
router.use('/categories', categoryRoutes);
router.use('/listings', listingRoutes);
router.use('/filters', filterRoutes);

module.exports = router;

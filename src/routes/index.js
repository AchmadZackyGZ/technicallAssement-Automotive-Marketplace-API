'use strict';

/**
 * API route registry.
 *
 * Every feature module exposes an Express router; this file is the single place
 * that decides what is mounted and under which path.
 *
 * Mount order matters. `/listings/search` must be registered before
 * `/listings/:id`, otherwise the `:id` parameter would swallow the literal
 * `search` segment. That ordering is enforced inside the listings router itself
 * so it cannot be broken by reordering this file.
 */

const express = require('express');

const { health } = require('./health');
const authRoutes = require('../modules/auth/auth.routes');
const categoryRoutes = require('../modules/categories/categories.routes');
const listingRoutes = require('../modules/listings/listings.routes');
const filterRoutes = require('../modules/filters/filters.routes');

const router = express.Router();

// Versioned health probe; the unversioned alias is mounted in app.js.
router.get('/health', health);

// --- Feature routers -------------------------------------------------------
router.use('/auth', authRoutes);
router.use('/categories', categoryRoutes);
router.use('/listings', listingRoutes);
router.use('/filters', filterRoutes);

module.exports = router;

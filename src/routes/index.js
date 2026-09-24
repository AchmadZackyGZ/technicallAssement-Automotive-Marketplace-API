'use strict';

/**
 * API route registry.
 *
 * Every feature module exposes an Express router; this file is the single place
 * that decides what is mounted and under which path. Mount order matters:
 * `/listings/search` must be registered before `/listings/:id`, otherwise the
 * `:id` parameter would swallow the literal `search` segment.
 */

const express = require('express');

const authRoutes = require('../modules/auth/auth.routes');
const categoryRoutes = require('../modules/categories/categories.routes');

const router = express.Router();

/** Liveness/readiness probe - deliberately unversioned and unauthenticated. */
router.get('/health', async (_req, res) => {
  const db = require('../utils/db');
  const redis = require('../utils/redis');

  const [database, cache] = await Promise.all([db.healthCheck(), redis.healthCheck()]);
  const healthy = database.ok;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database, cache },
  });
});

// --- Feature routers -------------------------------------------------------
router.use('/auth', authRoutes);
router.use('/categories', categoryRoutes);

module.exports = router;

'use strict';

/**
 * Liveness / readiness probe.
 *
 * Exposed at both `/health` and `${API_PREFIX}/health`: hosting platforms
 * (Railway, Render) probe the root path, while API clients expect everything
 * under the version prefix. Sharing one handler keeps the two in step.
 *
 * Reports 503 when the database is unreachable - the service is useless without
 * it. Redis is reported but never fails the probe, because the API is designed
 * to run without a cache.
 */

const db = require('../utils/db');
const redis = require('../utils/redis');

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [System]
 *     summary: Liveness and readiness probe
 *     description: |
 *       Reports 200 when PostgreSQL is reachable and 503 when it is not - the
 *       service is useless without its database. Redis is reported but never
 *       fails the probe, because the API is designed to run without a cache.
 *
 *       Also served at `/health` without the version prefix, since hosting
 *       platforms probe the root path.
 *     responses:
 *       200:
 *         description: Healthy
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HealthStatus' }
 *       503:
 *         description: Degraded - the database is unreachable
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HealthStatus' }
 */
async function health(_req, res) {
  const [database, cache] = await Promise.all([db.healthCheck(), redis.healthCheck()]);

  res.status(database.ok ? 200 : 503).json({
    status: database.ok ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database, cache },
  });
}

module.exports = { health };

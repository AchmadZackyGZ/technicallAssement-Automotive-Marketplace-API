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

async function health(_req, res) {
  const [database, cache] = await Promise.all([db.healthCheck(), redis.healthCheck()]);

  res.status(database.ok ? 200 : 503).json({
    status: database.ok ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database, cache },
  });
}

module.exports = { health };

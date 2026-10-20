'use strict';

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

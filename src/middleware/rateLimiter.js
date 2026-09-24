'use strict';

/**
 * Rate limiting.
 *
 * Two limiters:
 *   - `apiLimiter`   - generous global guard applied to every route
 *   - `authLimiter`  - strict limit for credential endpoints (brute-force guard)
 *
 * Both are disabled while running the test suite.
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

const sharedOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests. Please slow down and try again shortly.',
      },
    });
  },
};

const apiLimiter = rateLimit({
  ...sharedOptions,
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
});

const authLimiter = rateLimit({
  ...sharedOptions,
  windowMs: config.rateLimit.windowMs,
  max: Math.max(5, Math.floor(config.rateLimit.max / 10)),
});

module.exports = { apiLimiter, authLimiter };

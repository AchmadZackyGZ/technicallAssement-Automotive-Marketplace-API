'use strict';

/**
 * Wraps an async route handler so rejected promises reach the error middleware.
 *
 * Express 4 does not await handlers, so without this every controller would need
 * its own try/catch/next boilerplate.
 *
 * @param {Function} handler
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };

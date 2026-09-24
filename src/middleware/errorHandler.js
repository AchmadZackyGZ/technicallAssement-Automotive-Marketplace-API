'use strict';

/**
 * Terminal error-handling middleware.
 *
 * Translates anything thrown in the request pipeline into the API's uniform
 * error envelope:
 *
 *   { "error": { "code": "...", "message": "...", "details": [...] } }
 *
 * Known error shapes are mapped explicitly (Zod, PostgreSQL, JWT); everything
 * else becomes a 500 with the message hidden in production.
 */

const { ZodError } = require('zod');
const config = require('../config');
const logger = require('../utils/logger');
const { AppError, NotFoundError } = require('../utils/errors');

/** PostgreSQL error codes we can translate into meaningful HTTP responses. */
const PG_ERROR_MAP = {
  23505: { status: 409, code: 'CONFLICT', message: 'Resource already exists' },
  23503: { status: 409, code: 'FOREIGN_KEY_VIOLATION', message: 'Referenced resource does not exist' },
  23502: { status: 400, code: 'NOT_NULL_VIOLATION', message: 'A required field was missing' },
  23514: { status: 400, code: 'CHECK_VIOLATION', message: 'A field value is not allowed' },
  '22P02': { status: 400, code: 'INVALID_INPUT_SYNTAX', message: 'Malformed value provided' },
};

function notFound(req, _res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars -- Express identifies handlers by arity
function errorHandler(error, req, res, _next) {
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred';
  let details;

  if (error instanceof ZodError) {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
      code: issue.code,
    }));
  } else if (error instanceof AppError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error && error.code && PG_ERROR_MAP[error.code]) {
    const mapped = PG_ERROR_MAP[error.code];
    statusCode = mapped.status;
    code = mapped.code;
    message = mapped.message;
    details = error.detail ? { detail: error.detail } : undefined;
  } else if (error && error.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid authentication token';
  } else if (error && error.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Authentication token has expired';
  } else if (error && error.type === 'entity.parse.failed') {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Request body contains malformed JSON';
  }

  const isServerError = statusCode >= 500;

  if (isServerError) {
    logger.error('Unhandled request error', {
      method: req.method,
      path: req.originalUrl,
      error: error?.message,
      stack: error?.stack,
    });
  } else {
    logger.debug('Request rejected', {
      method: req.method,
      path: req.originalUrl,
      statusCode,
      code,
    });
  }

  if (isServerError && config.isProduction) {
    message = 'An unexpected error occurred';
  } else if (isServerError && error?.message) {
    message = error.message;
  }

  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  if (config.isDevelopment && isServerError && error?.stack) {
    body.error.stack = error.stack.split('\n');
  }

  res.status(statusCode).json(body);
}

module.exports = { errorHandler, notFound };

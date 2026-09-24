'use strict';

/**
 * Typed application errors.
 *
 * Controllers and services throw these; `middleware/errorHandler` is the only
 * place that knows how to turn them into an HTTP response. Every error carries
 * a stable machine-readable `code` so API consumers never have to parse prose.
 */

class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad request', details) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details) {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', details) {
    super(401, 'UNAUTHORIZED', message, details);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action', details) {
    super(403, 'FORBIDDEN', message, details);
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource', details) {
    super(404, 'NOT_FOUND', `${resource} not found`, details);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists', details) {
    super(409, 'CONFLICT', message, details);
  }
}

class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', details) {
    super(429, 'TOO_MANY_REQUESTS', message, details);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
};

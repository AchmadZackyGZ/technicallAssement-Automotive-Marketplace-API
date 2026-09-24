'use strict';

/**
 * Zod validation middleware.
 *
 * Controllers receive already-parsed, already-coerced input, so no route ever
 * reads a raw string off `req.query` or trusts the shape of `req.body`.
 *
 * Validated values are written back onto the request. `req.query` is redefined
 * with `Object.defineProperty` rather than assigned, because Express installs it
 * as a getter-only accessor on the request prototype and a plain assignment
 * would throw in strict mode.
 */

/**
 * @param {object} schemas
 * @param {import('zod').ZodTypeAny} [schemas.body]
 * @param {import('zod').ZodTypeAny} [schemas.query]
 * @param {import('zod').ZodTypeAny} [schemas.params]
 * @returns {import('express').RequestHandler}
 */
function validate(schemas = {}) {
  return (req, _res, next) => {
    try {
      if (schemas.params) {
        define(req, 'params', schemas.params.parse(req.params));
      }

      if (schemas.query) {
        define(req, 'query', schemas.query.parse(req.query));
      }

      if (schemas.body) {
        // A body-less request still needs to satisfy defaults / required fields.
        define(req, 'body', schemas.body.parse(req.body ?? {}));
      }

      next();
    } catch (error) {
      // ZodError is translated into a 422 by the central error handler.
      next(error);
    }
  };
}

function define(req, key, value) {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

module.exports = { validate };

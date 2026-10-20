'use strict';

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
        define(req, 'body', schemas.body.parse(req.body ?? {}));
      }

      next();
    } catch (error) {
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

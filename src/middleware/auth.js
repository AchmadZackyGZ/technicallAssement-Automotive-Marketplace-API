'use strict';

/**
 * Authentication / authorisation middleware.
 *
 * Tokens are JWTs signed with HS256. `authenticate` is mandatory for protected
 * routes; `optionalAuth` decorates `req.user` when a token happens to be present
 * so endpoints such as GET /listings/:id can personalise the response (e.g.
 * "is this listing favourited?") without requiring a login.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

/** Pull a bearer token out of the Authorization header. */
function extractToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;

  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;

  return token.trim();
}

/**
 * Verify a token and return its payload.
 * @throws {UnauthorizedError}
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Authentication token has expired');
    }
    throw new UnauthorizedError('Invalid authentication token');
  }
}

/** Require a valid token; 401 otherwise. */
function authenticate(req, _res, next) {
  const token = extractToken(req);
  if (!token) {
    return next(new UnauthorizedError('Missing bearer token'));
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    req.token = token;
    return next();
  } catch (error) {
    return next(error);
  }
}

/** Attach `req.user` when a valid token is present; never rejects. */
function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    req.token = token;
  } catch {
    // An invalid token on a public route is not an error - just stay anonymous.
    req.user = undefined;
  }

  return next();
}

/**
 * Role gate. Use after `authenticate`:
 *   router.post('/', authenticate, requireRole('seller', 'admin'), handler)
 */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return next(
        new ForbiddenError(`This action requires one of the following roles: ${roles.join(', ')}`),
      );
    }
    return next();
  };
}

/**
 * Ownership gate: the acting user must own the resource, or be an admin.
 * `getOwnerId` receives the request and returns the owner's user id.
 */
function requireOwnership(getOwnerId) {
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(new UnauthorizedError('Authentication required'));
      if (req.user.role === 'admin') return next();

      const ownerId = await getOwnerId(req);
      // No owner means the resource does not exist. Fall through so the handler
      // can answer with a proper 404 instead of a misleading 403.
      if (!ownerId) return next();

      if (String(ownerId) !== String(req.user.id)) {
        return next(new ForbiddenError('You can only modify your own listings'));
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { authenticate, optionalAuth, requireRole, requireOwnership, extractToken };

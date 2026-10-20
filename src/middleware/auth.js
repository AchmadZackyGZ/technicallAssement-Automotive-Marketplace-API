'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

function extractToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;

  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;

  return token.trim();
}

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

function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    req.token = token;
  } catch {
    req.user = undefined;
  }

  return next();
}

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

function requireOwnership(getOwnerId) {
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(new UnauthorizedError('Authentication required'));
      if (req.user.role === 'admin') return next();

      const ownerId = await getOwnerId(req);
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

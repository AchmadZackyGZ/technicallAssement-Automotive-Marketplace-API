'use strict';

/**
 * HTTP layer for authentication.
 *
 * Controllers stay deliberately thin: read validated input, call the service,
 * shape the response. No SQL, no business rules.
 */

const { asyncHandler } = require('../../utils/asyncHandler');
const service = require('./auth.service');

/** POST /auth/register */
const register = asyncHandler(async (req, res) => {
  const result = await service.register(req.body);
  res.status(201).json({
    data: {
      user: result.user,
      token: result.token,
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
    },
  });
});

/** POST /auth/login */
const login = asyncHandler(async (req, res) => {
  const result = await service.login(req.body);
  res.json({
    data: {
      user: result.user,
      token: result.token,
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
    },
  });
});

/** GET /auth/me */
const me = asyncHandler(async (req, res) => {
  const user = await service.getProfile(req.user.id);
  res.json({ data: user });
});

/** PATCH /auth/me */
const updateMe = asyncHandler(async (req, res) => {
  const user = await service.updateProfile(req.user.id, req.body);
  res.json({ data: user });
});

module.exports = { register, login, me, updateMe };

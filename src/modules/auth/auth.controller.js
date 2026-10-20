"use strict";

const { asyncHandler } = require("../../utils/asyncHandler");
const service = require("./auth.service");

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

const me = asyncHandler(async (req, res) => {
  const user = await service.getProfile(req.user.id);
  res.json({ data: user });
});

const updateMe = asyncHandler(async (req, res) => {
  const user = await service.updateProfile(req.user.id, req.body);
  res.json({ data: user });
});

module.exports = { register, login, me, updateMe };

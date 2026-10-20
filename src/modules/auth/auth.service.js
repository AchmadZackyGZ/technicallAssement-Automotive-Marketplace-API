"use strict";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const config = require("../../config");
const logger = require("../../utils/logger");
const {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
} = require("../../utils/errors");
const repository = require("./auth.repository");

function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, config.bcryptRounds);
}

function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

function issueToken(user) {
  const token = jwt.sign(
    { email: user.email, role: user.role },
    config.jwt.secret,
    {
      algorithm: config.jwt.algorithm,
      expiresIn: config.jwt.expiresIn,
      issuer: config.jwt.issuer,
      subject: String(user.id),
    },
  );

  return { token, expiresIn: config.jwt.expiresIn, tokenType: "Bearer" };
}

async function register({ email, password, name, phone, role }) {
  if (await repository.emailExists(email)) {
    throw new ConflictError("An account with this email already exists", {
      field: "email",
    });
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await repository.create({
      email,
      passwordHash,
      name,
      phone,
      role,
    });
    logger.info("User registered", { userId: user.id, role: user.role });

    return { user, ...issueToken(user) };
  } catch (error) {
    if (error.code === "23505") {
      throw new ConflictError("An account with this email already exists", {
        field: "email",
      });
    }
    throw error;
  }
}

async function login({ email, password }) {
  const user = await repository.findByEmailWithHash(email);

  if (!user) {
    await bcrypt.compare(
      password,
      "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva",
    );
    throw new UnauthorizedError("Invalid email or password");
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    throw new UnauthorizedError("Invalid email or password");
  }

  if (!user.isActive) {
    throw new UnauthorizedError("This account has been deactivated");
  }

  delete user.passwordHash;
  logger.info("User logged in", { userId: user.id });

  return { user, ...issueToken(user) };
}

async function getProfile(userId) {
  const user = await repository.findById(userId);
  if (!user) throw new NotFoundError("User");
  return user;
}

async function updateProfile(userId, payload) {
  const user = await repository.updateProfile(userId, payload);
  if (!user) throw new NotFoundError("User");
  return user;
}

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  hashPassword,
  verifyPassword,
  issueToken,
};

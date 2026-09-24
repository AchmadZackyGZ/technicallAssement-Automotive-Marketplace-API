'use strict';

/**
 * Authentication business logic.
 *
 * Password hashing (bcrypt), token issuing and the "is this email taken?" rule
 * live here; the repository only knows SQL and the controller only knows HTTP.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const config = require('../../config');
const logger = require('../../utils/logger');
const { ConflictError, UnauthorizedError, NotFoundError } = require('../../utils/errors');
const repository = require('./auth.repository');

/**
 * Hash a plaintext password with bcrypt.
 * @param {string} plainPassword
 * @returns {Promise<string>}
 */
function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, config.bcryptRounds);
}

/**
 * Constant-time comparison is handled by bcrypt itself.
 * @returns {Promise<boolean>}
 */
function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

/**
 * Sign an HS256 access token.
 *
 * The payload stays minimal: `sub` (user id) plus the claims the API needs for
 * authorisation. Anything else belongs in the database, not in a token the
 * client can read.
 *
 * @param {object} user
 * @returns {{ token: string, expiresIn: string }}
 */
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

  return { token, expiresIn: config.jwt.expiresIn, tokenType: 'Bearer' };
}

/**
 * Register a new account and return it together with a ready-to-use token.
 * @throws {ConflictError} when the email is already registered
 */
async function register({ email, password, name, phone, role }) {
  if (await repository.emailExists(email)) {
    throw new ConflictError('An account with this email already exists', { field: 'email' });
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await repository.create({ email, passwordHash, name, phone, role });
    logger.info('User registered', { userId: user.id, role: user.role });

    return { user, ...issueToken(user) };
  } catch (error) {
    // Unique-violation race: two concurrent registrations for the same email.
    if (error.code === '23505') {
      throw new ConflictError('An account with this email already exists', { field: 'email' });
    }
    throw error;
  }
}

/**
 * Verify credentials and issue a token.
 *
 * The same generic message is returned whether the email is unknown or the
 * password is wrong, so the endpoint cannot be used to enumerate accounts.
 *
 * @throws {UnauthorizedError}
 */
async function login({ email, password }) {
  const user = await repository.findByEmailWithHash(email);

  // Compare against a dummy hash when the user is missing so the response time
  // does not reveal whether the account exists.
  if (!user) {
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    throw new UnauthorizedError('Invalid email or password');
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    throw new UnauthorizedError('Invalid email or password');
  }

  if (!user.isActive) {
    throw new UnauthorizedError('This account has been deactivated');
  }

  delete user.passwordHash;
  logger.info('User logged in', { userId: user.id });

  return { user, ...issueToken(user) };
}

/** @throws {NotFoundError} */
async function getProfile(userId) {
  const user = await repository.findById(userId);
  if (!user) throw new NotFoundError('User');
  return user;
}

/** Update the authenticated user's own profile. */
async function updateProfile(userId, payload) {
  const user = await repository.updateProfile(userId, payload);
  if (!user) throw new NotFoundError('User');
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

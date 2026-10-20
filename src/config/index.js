'use strict';

require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function env(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

function requiredEnv(name, fallback) {
  const value = env(name, fallback);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function envInt(name, fallback) {
  const raw = env(name, fallback);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envBool(name, fallback) {
  const raw = env(name, fallback);
  if (raw === undefined) return fallback;
  if (typeof raw === 'boolean') return raw;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

const DATABASE_URL = env('DATABASE_URL');
const PGHOST = env('PGHOST');

if (isProduction && !DATABASE_URL && !PGHOST) {
  throw new Error('Either DATABASE_URL or PGHOST must be set when NODE_ENV=production.');
}

const jwtSecret = requiredEnv(
  'JWT_SECRET',
  isProduction ? undefined : 'dev-only-insecure-secret-do-not-use-in-production',
);

const config = {
  env: NODE_ENV,
  isProduction,
  isTest,
  isDevelopment: NODE_ENV === 'development',

  port: envInt('PORT', 3000),
  apiPrefix: env('API_PREFIX', '/api/v1'),

  db: {
    connectionString: DATABASE_URL,
    host: env('PGHOST', 'localhost'),
    port: envInt('PGPORT', 5432),
    user: env('PGUSER', 'postgres'),
    password: env('PGPASSWORD', 'postgres'),
    database: env('PGDATABASE', 'automotive_marketplace'),
    ssl: envBool('DB_SSL', false) ? { rejectUnauthorized: false } : false,
    pool: {
      max: envInt('DB_POOL_MAX', 10),
      idleTimeoutMillis: envInt('DB_IDLE_TIMEOUT_MS', 30000),
      connectionTimeoutMillis: envInt('DB_CONNECTION_TIMEOUT_MS', 5000),
    },
  },

  jwt: {
    secret: jwtSecret,
    expiresIn: env('JWT_EXPIRES_IN', '7d'),
    issuer: env('JWT_ISSUER', 'automotive-marketplace-api'),
    algorithm: 'HS256',
  },

  bcryptRounds: envInt('BCRYPT_ROUNDS', 10),

  redis: {
    url: env('REDIS_URL'),
    ttlSeconds: envInt('CACHE_TTL_SECONDS', 60),
    enabled: envBool('CACHE_ENABLED', true) && Boolean(env('REDIS_URL')),
  },

  cors: {
    origin: env('CORS_ORIGIN', '*'),
  },

  rateLimit: {
    windowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000),
    max: envInt('RATE_LIMIT_MAX', 300),
  },

  seed: {
    listings: envInt('SEED_LISTINGS', 600),
    sellers: envInt('SEED_SELLERS', 25),
    reset: envBool('SEED_RESET', false),
  },
};

module.exports = config;

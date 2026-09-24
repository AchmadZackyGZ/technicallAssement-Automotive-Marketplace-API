'use strict';

/**
 * PostgreSQL access layer.
 *
 * The assessment forbids an ORM, so this module owns the single `pg.Pool` and
 * exposes three primitives that the repositories build on:
 *
 *   - `query()`          - parameterised single statement
 *   - `withTransaction()` - run several statements atomically
 *   - `healthCheck()`     - readiness probe used by `/health`
 *
 * Slow queries are logged so index regressions are visible during development.
 */

const { Pool } = require('pg');
const config = require('../config');
const logger = require('./logger');

const poolOptions = config.db.connectionString
  ? { connectionString: config.db.connectionString, ssl: config.db.ssl }
  : {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      ssl: config.db.ssl,
    };

const pool = new Pool({
  ...poolOptions,
  max: config.db.pool.max,
  idleTimeoutMillis: config.db.pool.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.pool.connectionTimeoutMillis,
  application_name: 'automotive-marketplace-api',
});

pool.on('error', (error) => {
  // An idle client emitted an error - log it, the pool discards the client.
  logger.error('Unexpected PostgreSQL pool error', { error: error.message });
});

const SLOW_QUERY_MS = 200;

/**
 * Execute a parameterised SQL statement.
 *
 * @param {string} text  SQL with $1, $2 ... placeholders
 * @param {Array}  params Values bound to the placeholders
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params = []) {
  const startedAt = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - startedAt;

    if (duration >= SLOW_QUERY_MS) {
      logger.warn('Slow query detected', {
        durationMs: duration,
        rows: result.rowCount,
        // Collapse whitespace so multi-line SQL stays on one log line.
        sql: text.replace(/\s+/g, ' ').trim().slice(0, 300),
      });
    } else {
      logger.debug('Query executed', { durationMs: duration, rows: result.rowCount });
    }

    return result;
  } catch (error) {
    logger.error('Query failed', {
      error: error.message,
      code: error.code,
      sql: text.replace(/\s+/g, ' ').trim().slice(0, 300),
    });
    throw error;
  }
}

/**
 * Convenience helper for queries expected to return a single row.
 * @returns {Promise<object|null>}
 */
async function queryOne(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

/**
 * Run `callback` inside a transaction. The callback receives a dedicated
 * client; every statement it issues must use that client, not `pool.query`.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} callback
 * @returns {Promise<T>}
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('Transaction rollback failed', { error: rollbackError.message });
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Readiness probe. Returns a boolean instead of throwing so the HTTP layer can
 * decide how to report it.
 */
async function healthCheck() {
  try {
    const startedAt = Date.now();
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, queryOne, withTransaction, healthCheck, close };

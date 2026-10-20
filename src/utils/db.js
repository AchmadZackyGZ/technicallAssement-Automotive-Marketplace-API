'use strict';

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
  logger.error('Unexpected PostgreSQL pool error', { error: error.message });
});

const SLOW_QUERY_MS = 200;

async function query(text, params = []) {
  const startedAt = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - startedAt;

    if (duration >= SLOW_QUERY_MS) {
      logger.warn('Slow query detected', {
        durationMs: duration,
        rows: result.rowCount,
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

async function queryOne(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

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

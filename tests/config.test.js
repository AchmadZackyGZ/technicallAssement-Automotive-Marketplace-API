'use strict';

/**
 * Configuration tests.
 *
 * Each case runs `src/config` in a fresh child process, because the module reads
 * `process.env` at require time. Spawning is the honest way to test that - it
 * exercises the real boot path, including the `dotenv` load and the production
 * guards, rather than a mocked approximation.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const CONFIG_MODULE = path.join(__dirname, '..', 'src', 'config', 'index.js');

/**
 * Load the config in a child process and return the serialised result.
 *
 * The child runs with its working directory set to the OS temp directory, so
 * `dotenv` finds no `.env` file and each case sees exactly the variables it
 * declares - otherwise the developer's own .env would leak into the assertions.
 *
 * @returns {{ ok: boolean, config?: object, error?: string }}
 */
function loadConfig(env) {
  const script = `
    try {
      const config = require(${JSON.stringify(CONFIG_MODULE)});
      process.stdout.write(JSON.stringify({
        ok: true,
        config: {
          env: config.env,
          port: config.port,
          apiPrefix: config.apiPrefix,
          db: {
            connectionString: config.db.connectionString,
            host: config.db.host,
            port: config.db.port,
            ssl: config.db.ssl,
          },
          jwt: { secret: config.jwt.secret, algorithm: config.jwt.algorithm },
          redis: { url: config.redis.url, enabled: config.redis.enabled },
          cors: config.cors,
        },
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    }
  `;

  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env },
    encoding: 'utf8',
  });

  return JSON.parse(output);
}

describe('configuration', () => {
  it('boots in development with no environment at all', () => {
    const result = loadConfig({ NODE_ENV: 'development' });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.config.port, 3000);
    assert.equal(result.config.apiPrefix, '/api/v1');
    assert.equal(result.config.db.host, 'localhost');
    assert.equal(result.config.db.port, 5432);
    assert.equal(result.config.jwt.algorithm, 'HS256', 'the algorithm must be pinned');
    assert.equal(result.config.redis.enabled, false, 'no REDIS_URL means caching is off');
  });

  it('refuses to boot in production without JWT_SECRET', () => {
    const result = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://user:pass@host:5432/db',
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /JWT_SECRET/);
  });

  it('refuses to boot in production with no database configuration', () => {
    const result = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(40) });

    assert.equal(result.ok, false);
    assert.match(result.error, /DATABASE_URL or PGHOST/);
  });

  it('boots in production from DATABASE_URL alone', () => {
    const result = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(40),
      DATABASE_URL: 'postgres://user:pass@db.internal:5432/marketplace',
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.config.db.connectionString, 'postgres://user:pass@db.internal:5432/marketplace');
  });

  it('boots in production from the discrete PG* variables alone', () => {
    // Regression test. envInt/envBool used to call env(name) without forwarding
    // their fallback, which made every optional PG* variable mandatory in
    // production - the app refused to start unless all of them were set.
    const result = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(40),
      PGHOST: 'db.internal',
      PGDATABASE: 'marketplace',
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.config.db.host, 'db.internal');
    assert.equal(result.config.db.port, 5432, 'PGPORT should fall back to 5432, not be required');
    assert.equal(result.config.port, 3000, 'PORT should fall back to 3000, not be required');
  });

  it('parses booleans and integers from strings', () => {
    const result = loadConfig({
      NODE_ENV: 'development',
      PORT: '8080',
      DB_SSL: 'true',
      REDIS_URL: 'redis://cache:6379',
      CACHE_ENABLED: 'true',
    });

    assert.equal(result.config.port, 8080);
    assert.deepEqual(result.config.db.ssl, { rejectUnauthorized: false });
    assert.equal(result.config.redis.enabled, true);
  });

  it('treats CACHE_ENABLED=false as disabling caching even with a URL', () => {
    const result = loadConfig({
      NODE_ENV: 'development',
      REDIS_URL: 'redis://cache:6379',
      CACHE_ENABLED: 'false',
    });

    assert.equal(result.config.redis.enabled, false);
  });

  it('falls back to a default when an integer variable is unparseable', () => {
    const result = loadConfig({ NODE_ENV: 'development', PORT: 'not-a-number' });

    assert.equal(result.config.port, 3000);
  });

  it('parses a comma-separated CORS origin list verbatim', () => {
    const result = loadConfig({
      NODE_ENV: 'development',
      CORS_ORIGIN: 'https://a.example,https://b.example',
    });

    assert.equal(result.config.cors.origin, 'https://a.example,https://b.example');
  });
});

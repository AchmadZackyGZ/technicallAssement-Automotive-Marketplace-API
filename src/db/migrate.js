'use strict';

/**
 * Zero-dependency SQL migration runner.
 *
 * The assessment forbids ORMs, and pulling in a migration framework would add
 * ceremony without value at this size. Instead we keep plain `.sql` files:
 *
 *   src/db/migrations/003_categories.up.sql
 *   src/db/migrations/003_categories.down.sql
 *
 * Files are applied in lexicographic order, each inside its own transaction, and
 * recorded in `schema_migrations`. Re-running `up` is therefore always safe.
 *
 * Usage:
 *   node src/db/migrate.js up        # apply every pending migration
 *   node src/db/migrate.js down      # revert the most recent migration
 *   node src/db/migrate.js status    # show applied vs pending
 *   node src/db/migrate.js reset     # revert everything
 */

const fs = require('node:fs');
const path = require('node:path');
const db = require('../utils/db');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(32) PRIMARY KEY,
      name        VARCHAR(200) NOT NULL,
      checksum    VARCHAR(64) NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/** Discover migration pairs on disk, sorted by version. */
function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const byVersion = new Map();

  for (const file of files) {
    const match = /^(\d+)_([a-z0-9_]+)\.(up|down)\.sql$/i.exec(file);
    if (!match) continue;

    const [, version, name, direction] = match;
    const entry = byVersion.get(version) || { version, name, up: null, down: null };
    entry[direction] = path.join(MIGRATIONS_DIR, file);
    byVersion.set(version, entry);
  }

  return [...byVersion.values()].sort((a, b) => a.version.localeCompare(b.version));
}

async function getAppliedVersions(client) {
  const { rows } = await client.query('SELECT version FROM schema_migrations');
  return new Set(rows.map((row) => row.version));
}

async function applyUp(version, name, file) {
  const sql = fs.readFileSync(file, 'utf8');
  await db.withTransaction(async (client) => {
    await ensureMigrationsTable(client);
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, md5($3))',
      [version, name, sql],
    );
  });
  logger.info('Migration applied', { version, name });
}

async function applyDown(version, name, file) {
  const sql = fs.readFileSync(file, 'utf8');
  await db.withTransaction(async (client) => {
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
  });
  logger.info('Migration reverted', { version, name });
}

async function up() {
  const migrations = listMigrations();
  if (!migrations.length) {
    logger.warn('No migration files found', { dir: MIGRATIONS_DIR });
    return;
  }

  const client = await db.pool.connect();
  let applied;
  try {
    await ensureMigrationsTable(client);
    applied = await getAppliedVersions(client);
  } finally {
    client.release();
  }

  const pending = migrations.filter((m) => !applied.has(m.version));
  if (!pending.length) {
    logger.info('Database is up to date', { applied: applied.size });
    return;
  }

  for (const migration of pending) {
    if (!migration.up) throw new Error(`Missing .up.sql for migration ${migration.version}`);
    // eslint-disable-next-line no-await-in-loop -- migrations must run sequentially
    await applyUp(migration.version, migration.name, migration.up);
  }

  logger.info('Migrations complete', { applied: pending.length, total: migrations.length });
}

async function down() {
  const migrations = listMigrations().reverse();

  const client = await db.pool.connect();
  let applied;
  try {
    await ensureMigrationsTable(client);
    applied = await getAppliedVersions(client);
  } finally {
    client.release();
  }

  const last = migrations.find((m) => applied.has(m.version));
  if (!last) {
    logger.info('Nothing to revert');
    return;
  }
  if (!last.down) throw new Error(`Missing .down.sql for migration ${last.version}`);

  await applyDown(last.version, last.name, last.down);
}

async function reset() {
  const migrations = listMigrations().reverse();

  const client = await db.pool.connect();
  let applied;
  try {
    await ensureMigrationsTable(client);
    applied = await getAppliedVersions(client);
  } finally {
    client.release();
  }

  for (const migration of migrations) {
    if (!applied.has(migration.version)) continue;
    if (!migration.down) throw new Error(`Missing .down.sql for migration ${migration.version}`);
    // eslint-disable-next-line no-await-in-loop -- reverting must run in reverse order
    await applyDown(migration.version, migration.name, migration.down);
  }

  logger.info('Database reset complete');
}

async function status() {
  const migrations = listMigrations();

  const client = await db.pool.connect();
  let applied;
  try {
    await ensureMigrationsTable(client);
    applied = await getAppliedVersions(client);
  } finally {
    client.release();
  }

  const rows = migrations.map((m) => ({
    version: m.version,
    name: m.name,
    status: applied.has(m.version) ? 'applied' : 'pending',
  }));

  // eslint-disable-next-line no-console -- CLI output
  console.table(rows);
  return rows;
}

async function main() {
  const command = (process.argv[2] || 'up').toLowerCase();
  const commands = { up, down, status, reset };

  if (!commands[command]) {
    // eslint-disable-next-line no-console -- CLI output
    console.error(`Unknown command "${command}". Use one of: ${Object.keys(commands).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  try {
    await commands[command]();
  } catch (error) {
    logger.error('Migration failed', { error: error.message, code: error.code });
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { listMigrations, up, down, reset, status };

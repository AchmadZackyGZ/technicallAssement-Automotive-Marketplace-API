'use strict';

/**
 * Seed the database with realistic Indonesian marketplace data.
 *
 *   npm run seed
 *
 * WHAT IT DOES
 *   Resets marketplace data (categories, filter definitions, users, listings,
 *   images, attributes, favourites) and regenerates it from scratch. This is
 *   destructive by design: a seed command that half-appends to existing data is
 *   not reproducible.
 *
 * DETERMINISM
 *   Generation uses a seeded PRNG, so the same `SEED_RANDOM_SEED` always
 *   produces the same listings. Two reviewers running this get identical data,
 *   which makes the numbers in the README and the screenshots verifiable.
 *
 * CONFIGURATION (see .env.example)
 *   SEED_LISTINGS      number of listings to generate (default 600, min 500)
 *   SEED_SELLERS       number of seller accounts        (default 25)
 *   SEED_RANDOM_SEED   PRNG seed                        (default 42)
 */

const db = require('../utils/db');
const logger = require('../utils/logger');
const config = require('../config');

const { createRandom } = require('./seeds/seed-helpers');
const { seedCategories } = require('./seeds/categories.seed');
const { seedUsers } = require('./seeds/users.seed');
const { seedListings } = require('./seeds/listings.seed');

/**
 * Order matters only for readability - CASCADE handles the dependencies.
 * RESTART IDENTITY keeps sequences tidy for any future serial columns.
 */
const RESET_SQL = `
  TRUNCATE TABLE
    listing_attributes,
    listing_images,
    favorites,
    listings,
    filter_definitions,
    categories,
    users
  RESTART IDENTITY CASCADE
`;

/** Minimum the brief asks for. */
const MIN_LISTINGS = 500;

async function run() {
  const randomSeed = Number(process.env.SEED_RANDOM_SEED ?? 42);
  const listingCount = Math.max(MIN_LISTINGS, Number(process.env.SEED_LISTINGS ?? config.seed.listings));
  const sellerCount = Number(process.env.SEED_SELLERS ?? config.seed.sellers);

  const random = createRandom(randomSeed);
  const startedAt = Date.now();

  logger.info('Seeding database', {
    listings: listingCount,
    sellers: sellerCount,
    randomSeed,
    database: config.db.connectionString ? 'DATABASE_URL' : `${config.db.host}:${config.db.port}/${config.db.database}`,
  });

  const summary = await db.withTransaction(async (client) => {
    await client.query(RESET_SQL);

    const categories = await seedCategories(client);
    logger.info('Categories and filter definitions seeded', {
      categories: categories.idsBySlug.size,
      filterDefinitions: categories.definitions,
    });

    const users = await seedUsers(client, { random, sellerCount });
    logger.info('Users seeded', { sellers: users.sellerIds.length });

    const listings = await seedListings(client, {
      random,
      count: listingCount,
      sellerIds: users.sellerIds,
      idsBySlug: categories.idsBySlug,
    });
    logger.info('Listings seeded', listings);

    return { categories, users, listings };
  });

  // --- Report --------------------------------------------------------------
  const [stats, sampleFacets] = await Promise.all([
    db.query(`
      SELECT
        (SELECT COUNT(*) FROM categories)         ::int AS categories,
        (SELECT COUNT(*) FROM filter_definitions) ::int AS filter_definitions,
        (SELECT COUNT(*) FROM users)              ::int AS users,
        (SELECT COUNT(*) FROM listings)           ::int AS listings,
        (SELECT COUNT(*) FROM listing_images)     ::int AS images,
        (SELECT COUNT(*) FROM listing_attributes) ::int AS attributes,
        (SELECT COUNT(DISTINCT make) FROM listings)      AS makes,
        (SELECT COUNT(DISTINCT location_city) FROM listings) AS cities,
        (SELECT MIN(price) FROM listings)::bigint  AS min_price,
        (SELECT MAX(price) FROM listings)::bigint  AS max_price,
        (SELECT MIN(year) FROM listings)           AS min_year,
        (SELECT MAX(year) FROM listings)           AS max_year
    `),
    db.query(`
      SELECT make, COUNT(*)::int AS listings
        FROM listings
       GROUP BY make
       ORDER BY listings DESC
       LIMIT 5
    `),
  ]);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

  // eslint-disable-next-line no-console -- CLI summary
  console.log('\n=== Seed complete ===');
  // eslint-disable-next-line no-console -- CLI summary
  console.table(stats.rows[0]);
  // eslint-disable-next-line no-console -- CLI summary
  console.log('\nTop makes:');
  // eslint-disable-next-line no-console -- CLI summary
  console.table(sampleFacets.rows);

  // eslint-disable-next-line no-console -- CLI summary
  console.log(`
Demo credentials
  admin  admin@automotive.test  / Admin12345   (may create/update categories)
  buyer  buyer@automotive.test  / Buyer12345
  seller seller1@automotive.test / Seller12345 (owns seeded listings)

Finished in ${elapsed}s.
`);

  logger.info('Seed complete', { elapsedSeconds: Number(elapsed), listings: summary.listings.listings });
}

async function main() {
  try {
    await run();
  } catch (error) {
    logger.error('Seed failed', { error: error.message, code: error.code, detail: error.detail });
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { run, RESET_SQL };

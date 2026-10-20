'use strict';

const db = require('../utils/db');
const logger = require('../utils/logger');
const config = require('../config');

const { createRandom } = require('./seeds/seed-helpers');
const { seedCategories } = require('./seeds/categories.seed');
const { seedUsers } = require('./seeds/users.seed');
const { seedListings } = require('./seeds/listings.seed');

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

  console.log('\n=== Seed complete ===');
  console.table(stats.rows[0]);
  console.log('\nTop makes:');
  console.table(sampleFacets.rows);

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

'use strict';

const { CITIES, COLORS, CARS, MOTORCYCLES, COMMERCIAL } = require('./reference-data');
const { intBetween, floatBetween, pick, pickWeighted, chance, insertInBatches, imageUrls } = require('./seed-helpers');

const NEWEST_YEAR = 2024;
const OLDEST_YEAR = 2015;

const BRANCHES = [
  { name: 'cars', weight: 70, entries: CARS },
  { name: 'motorcycles', weight: 22, entries: MOTORCYCLES },
  { name: 'commercial-vehicles', weight: 8, entries: COMMERCIAL },
];

const CAR_TRIMS = ['G', 'E', 'V', 'S', 'GL', 'Sport', 'Premium', 'Standard', 'Limited', 'Dakar'];
const BIKE_TRIMS = ['CBS', 'ABS', 'Standard', 'Deluxe', 'SE'];

const CONDITION_WEIGHTS = [
  { value: 'used', weight: 72 },
  { value: 'certified', weight: 16 },
  { value: 'new', weight: 12 },
];

const STATUS_WEIGHTS = [
  { value: 'available', weight: 88 },
  { value: 'sold', weight: 7 },
  { value: 'pending', weight: 5 },
];

const CONDITION_LABEL = { new: 'brand new', used: 'used', certified: 'certified pre-owned' };

function pickTransmission(random, branch, bikeType) {
  if (branch === 'motorcycles') {
    if (bikeType === 'matic') return chance(random, 0.65) ? 'cvt' : 'automatic';
    if (bikeType === 'bebek') return 'manual';
    return chance(random, 0.8) ? 'manual' : 'automatic';
  }

  if (branch === 'commercial-vehicles') {
    return chance(random, 0.9) ? 'manual' : 'automatic';
  }

  return pickWeighted(random, [
    { value: 'automatic', weight: 42 },
    { value: 'manual', weight: 33 },
    { value: 'cvt', weight: 25 },
  ]).value;
}

function pickFuel(random, branch, entry) {
  if (branch === 'motorcycles') return 'gasoline';
  if (branch === 'commercial-vehicles') return chance(random, 0.9) ? 'diesel' : 'gasoline';
  return pick(random, entry.fuel);
}

function computePrice(random, entry, year, condition, branch) {
  const [bandMin, bandMax] = entry.price;
  const asNew = floatBetween(random, bandMin, bandMax);

  if (condition === 'new') {
    const step = branch === 'motorcycles' ? 100_000 : 1_000_000;
    return Math.round(asNew / step) * step;
  }

  const age = NEWEST_YEAR - year;
  const retention = Math.max(0.38, 1 - 0.085 * age);
  const value = asNew * retention * floatBetween(random, 0.94, 1.06);

  const step = branch === 'motorcycles' ? 100_000 : 500_000;
  return Math.max(step, Math.round(value / step) * step);
}

function computeMileage(random, year, condition) {
  if (condition === 'new') return intBetween(random, 0, 150);

  const age = Math.max(0, NEWEST_YEAR - year);

  if (condition === 'certified') return intBetween(random, 1_000, 8_000 * Math.max(age, 1));

  const expected = 13_000 * Math.max(age, 1);
  return Math.min(280_000, Math.max(1_000, Math.round(expected * floatBetween(random, 0.55, 1.45))));
}

function buildTitle(year, entry, trim, transmission, branch) {
  const short = { manual: 'MT', automatic: 'AT', cvt: 'CVT' }[transmission];
  if (branch === 'commercial-vehicles') return `${year} ${entry.make} ${entry.model} ${short}`;
  return `${year} ${entry.make} ${entry.model} ${trim} ${short}`;
}

function buildDescription(random, { entry, year, condition, mileage, city, transmission, fuel }) {
  const fuelText = { gasoline: 'petrol', diesel: 'diesel', electric: 'electric', hybrid: 'hybrid' }[fuel];
  const transmissionText = { manual: 'manual', automatic: 'automatic', cvt: 'CVT' }[transmission];

  const openers = [
    `${entry.make} ${entry.model} ${year} in ${CONDITION_LABEL[condition]} condition.`,
    `Well maintained ${entry.make} ${entry.model} ${year}.`,
    `${entry.make} ${entry.model} ${year}, ${CONDITION_LABEL[condition]}, ready to drive.`,
  ];

  const features = [
    'Full service history at the official dealer.',
    'Single owner, non-accident, all documents complete.',
    'Recently serviced, new tyres, tax valid.',
    'Interior and exterior well kept, no flood damage.',
  ];

  return [
    pick(random, openers),
    `${mileage.toLocaleString('id-ID')} km on the clock, ${transmissionText} transmission, ${fuelText} engine.`,
    `Located in ${city}.`,
    pick(random, features),
    'Serious buyers only, price slightly negotiable.',
  ].join(' ');
}

function buildAttributes(random, branch, entry) {
  if (branch === 'cars') {
    const attributes = {
      seat_count: pick(random, entry.seats),
      drive_type: pick(random, entry.drive),
      has_sunroof: chance(random, entry.price[1] > 500_000_000 ? 0.45 : 0.08),
    };

    const engineCc = pick(random, entry.engineCc);
    if (engineCc > 0) attributes.engine_cc = engineCc;

    return attributes;
  }

  if (branch === 'motorcycles') {
    return {
      engine_cc: pick(random, entry.engineCc),
      has_abs: entry.hasAbs,
    };
  }

  return {
    payload_kg: pick(random, entry.payloadKg),
    wheel_count: pick(random, entry.wheels),
  };
}

async function loadDefinitionIds(client) {
  const { rows } = await client.query(
    `SELECT fd.id, fd.key, c.slug AS "categorySlug"
       FROM filter_definitions fd
       JOIN categories c ON c.id = fd.category_id`,
  );

  const byBranchAndKey = new Map();
  for (const row of rows) {
    byBranchAndKey.set(`${row.categorySlug}:${row.key}`, row.id);
  }
  return byBranchAndKey;
}

async function seedListings(client, { random, count, sellerIds, idsBySlug }) {
  const definitionIds = await loadDefinitionIds(client);

  const listingRows = [];
  const imagesByIndex = [];
  const attributesByIndex = [];

  for (let index = 0; index < count; index += 1) {
    const branch = pickWeighted(random, BRANCHES);
    const entry = pick(random, branch.entries);

    const condition = pickWeighted(random, CONDITION_WEIGHTS).value;
    const year = condition === 'new' ? NEWEST_YEAR : intBetween(random, OLDEST_YEAR, NEWEST_YEAR);

    const city = pickWeighted(random, CITIES);
    const transmission = pickTransmission(random, branch.name, entry.type);
    const fuel = pickFuel(random, branch.name, entry);
    const price = computePrice(random, entry, year, condition, branch.name);
    const mileage = computeMileage(random, year, condition);

    const trim = branch.name === 'motorcycles' ? pick(random, BIKE_TRIMS) : pick(random, CAR_TRIMS);
    const title = buildTitle(year, entry, trim, transmission, branch.name);

    const categorySlug = branch.name === 'cars' ? entry.body : entry.type;
    const categoryId = idsBySlug.get(categorySlug);
    if (!categoryId) throw new Error(`No seeded category for slug "${categorySlug}"`);

    const publishedAt = new Date(
      Date.now() - intBetween(random, 0, 180) * 86_400_000 - intBetween(random, 0, 1439) * 60_000,
    );

    listingRows.push([
      pick(random, sellerIds),
      categoryId,
      title,
      buildDescription(random, { entry, year, condition, mileage, city: city.city, transmission, fuel }),
      entry.make,
      entry.model,
      year,
      mileage,
      price,
      condition,
      transmission,
      fuel,
      pick(random, COLORS),
      city.city,
      city.province,
      pickWeighted(random, STATUS_WEIGHTS).value,
      chance(random, 0.06),
      Math.round(Math.pow(random(), 2.2) * 3_000),
      publishedAt,
      publishedAt,
    ]);

    const imageCount = intBetween(random, 3, 6);
    imagesByIndex.push(imageUrls(`${categorySlug}-${index + 1}`, imageCount));

    const attributeRows = [];
    for (const [key, value] of Object.entries(buildAttributes(random, branch.name, entry))) {
      const definitionId = definitionIds.get(`${branch.name}:${key}`);
      if (!definitionId) continue;

      attributeRows.push({
        definitionId,
        valueText: typeof value === 'string' ? value : null,
        valueNum: typeof value === 'number' ? value : null,
        valueBool: typeof value === 'boolean' ? value : null,
      });
    }
    attributesByIndex.push(attributeRows);
  }

  const { returned } = await insertInBatches(
    client,
    'listings',
    [
      'seller_id', 'category_id', 'title', 'description', 'make', 'model', 'year', 'mileage_km',
      'price', 'condition', 'transmission', 'fuel_type', 'color', 'location_city',
      'location_province', 'status', 'is_featured', 'view_count', 'published_at', 'created_at',
    ],
    listingRows,
    { returning: 'id', batchSize: 100 },
  );

  const imageRows = [];
  const attributeRows = [];

  returned.forEach((row, index) => {
    for (const image of imagesByIndex[index]) {
      imageRows.push([row.id, image.url, image.altText, image.position, image.isPrimary]);
    }

    for (const attribute of attributesByIndex[index]) {
      attributeRows.push([
        row.id,
        attribute.definitionId,
        attribute.valueText,
        attribute.valueNum,
        attribute.valueBool,
      ]);
    }
  });

  await insertInBatches(
    client,
    'listing_images',
    ['listing_id', 'url', 'alt_text', 'position', 'is_primary'],
    imageRows,
    { batchSize: 300 },
  );

  await insertInBatches(
    client,
    'listing_attributes',
    ['listing_id', 'definition_id', 'value_text', 'value_num', 'value_bool'],
    attributeRows,
    { batchSize: 300 },
  );

  return { listings: returned.length, images: imageRows.length, attributes: attributeRows.length };
}

module.exports = { seedListings, NEWEST_YEAR, OLDEST_YEAR };

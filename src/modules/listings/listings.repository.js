'use strict';

/**
 * Data access for listings.
 *
 * Multi-table writes (listing + images + attributes) go through
 * `db.withTransaction` so a listing can never end up half-created.
 */

const db = require('../../utils/db');

/**
 * Canonical projection. Every read goes through this so the JSON shape is
 * identical everywhere and `search_vector` / `deleted_at` internals never leak.
 */
const LISTING_COLUMNS = `
  l.id,
  l.seller_id         AS "sellerId",
  l.category_id       AS "categoryId",
  l.title,
  l.description,
  l.make,
  l.model,
  l.year,
  l.mileage_km        AS "mileageKm",
  l.condition,
  l.transmission,
  l.fuel_type         AS "fuelType",
  l.color,
  l.price,
  l.currency,
  l.status,
  l.is_featured       AS "isFeatured",
  l.location_city     AS "locationCity",
  l.location_province AS "locationProvince",
  l.view_count        AS "viewCount",
  l.published_at      AS "publishedAt",
  l.created_at        AS "createdAt",
  l.updated_at        AS "updatedAt",
  l.deleted_at        AS "deletedAt"
`;

/**
 * Same projection without the table alias, for statements (UPDATE ... RETURNING)
 * where no alias is in scope. Derived once at load time rather than string-hacked
 * per call.
 */
const LISTING_COLUMNS_UNALIASED = LISTING_COLUMNS.replace(/l\./g, '');

/** Client field name -> database column, for writes. */
const FIELD_TO_COLUMN = {
  categoryId: 'category_id',
  title: 'title',
  description: 'description',
  make: 'make',
  model: 'model',
  year: 'year',
  mileageKm: 'mileage_km',
  price: 'price',
  condition: 'condition',
  transmission: 'transmission',
  fuelType: 'fuel_type',
  color: 'color',
  locationCity: 'location_city',
  locationProvince: 'location_province',
  status: 'status',
  isFeatured: 'is_featured',
};

/** Database column -> client field name. Used to route column-backed filters. */
const COLUMN_TO_FIELD = Object.fromEntries(
  Object.entries(FIELD_TO_COLUMN).map(([field, column]) => [column, field]),
);

/** Fields a client may set through the `attributes` map when a definition maps to a column. */
const COLUMN_BACKED_FIELDS = new Set(Object.values(FIELD_TO_COLUMN));

/**
 * NUMERIC comes back from `pg` as a string to avoid precision loss. Prices here
 * are well inside IEEE-754's safe range, so converting to a number gives a
 * friendlier JSON payload without any real risk.
 */
function mapListing(row) {
  if (!row) return row;
  return {
    ...row,
    price: row.price === null || row.price === undefined ? row.price : Number(row.price),
    year: row.year === null || row.year === undefined ? row.year : Number(row.year),
  };
}

function mapAttribute(row) {
  const value =
    row.valueText !== null && row.valueText !== undefined
      ? row.valueText
      : row.valueNum !== null && row.valueNum !== undefined
        ? Number(row.valueNum)
        : row.valueBool;

  return {
    key: row.key,
    label: row.label,
    type: row.type,
    unit: row.unit,
    source: row.source,
    value,
  };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

async function insertImages(client, listingId, images) {
  if (!images?.length) return;

  // Exactly one primary: if the caller did not nominate one, promote the first.
  const hasPrimary = images.some((image) => image.isPrimary);

  const values = [];
  const params = [];
  images.forEach((image, index) => {
    const offset = index * 5;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
    params.push(
      listingId,
      image.url,
      image.altText ?? null,
      image.position ?? index,
      image.isPrimary ?? (!hasPrimary && index === 0),
    );
  });

  await client.query(
    `INSERT INTO listing_images (listing_id, url, alt_text, position, is_primary)
     VALUES ${values.join(', ')}`,
    params,
  );
}

async function findImages(listingId) {
  const { rows } = await db.query(
    `SELECT id, url, alt_text AS "altText", position, is_primary AS "isPrimary"
       FROM listing_images
      WHERE listing_id = $1
      ORDER BY position ASC, created_at ASC`,
    [listingId],
  );
  return rows;
}

async function replaceImages(client, listingId, images) {
  await client.query('DELETE FROM listing_images WHERE listing_id = $1', [listingId]);
  await insertImages(client, listingId, images);
}

// ---------------------------------------------------------------------------
// EAV attributes
// ---------------------------------------------------------------------------

/**
 * Upsert attribute rows.
 * @param {Array<{definitionId: string, valueText: ?string, valueNum: ?number, valueBool: ?boolean}>} attributes
 */
async function upsertAttributes(client, listingId, attributes) {
  if (!attributes?.length) return;

  const values = [];
  const params = [];
  attributes.forEach((attribute, index) => {
    const offset = index * 5;
    values.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`,
    );
    params.push(
      listingId,
      attribute.definitionId,
      attribute.valueText ?? null,
      attribute.valueNum ?? null,
      attribute.valueBool ?? null,
    );
  });

  await client.query(
    `INSERT INTO listing_attributes (listing_id, definition_id, value_text, value_num, value_bool)
     VALUES ${values.join(', ')}
     ON CONFLICT (listing_id, definition_id) DO UPDATE
        SET value_text = EXCLUDED.value_text,
            value_num  = EXCLUDED.value_num,
            value_bool = EXCLUDED.value_bool,
            updated_at = NOW()`,
    params,
  );
}

async function deleteAttributes(client, listingId, definitionIds) {
  if (!definitionIds?.length) return;
  await client.query(
    'DELETE FROM listing_attributes WHERE listing_id = $1 AND definition_id = ANY($2::uuid[])',
    [listingId, definitionIds],
  );
}

async function findAttributes(listingId) {
  const { rows } = await db.query(
    `SELECT fd.key,
            fd.label,
            fd.type,
            fd.unit,
            fd.source,
            fd.column_name AS "columnName",
            la.value_text  AS "valueText",
            la.value_num   AS "valueNum",
            la.value_bool  AS "valueBool"
       FROM listing_attributes la
       JOIN filter_definitions fd ON fd.id = la.definition_id
      WHERE la.listing_id = $1
      ORDER BY fd.sort_order ASC, fd.key ASC`,
    [listingId],
  );
  return rows.map(mapAttribute);
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

/**
 * Insert a listing together with its images and attributes, atomically.
 */
async function createWithRelations({ listing, images = [], attributes = [] }) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO listings (
         seller_id, category_id, title, description, make, model, year, mileage_km,
         price, condition, transmission, fuel_type, color,
         location_city, location_province, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, seller_id AS "sellerId", category_id AS "categoryId", title, description,
                 make, model, year, mileage_km AS "mileageKm", condition, transmission,
                 fuel_type AS "fuelType", color, price, currency, status,
                 is_featured AS "isFeatured", location_city AS "locationCity",
                 location_province AS "locationProvince", view_count AS "viewCount",
                 published_at AS "publishedAt", created_at AS "createdAt",
                 updated_at AS "updatedAt", deleted_at AS "deletedAt"`,
      [
        listing.sellerId,
        listing.categoryId,
        listing.title,
        listing.description ?? null,
        listing.make,
        listing.model,
        listing.year,
        listing.mileageKm ?? 0,
        listing.price,
        listing.condition ?? 'used',
        listing.transmission ?? null,
        listing.fuelType ?? null,
        listing.color ?? null,
        listing.locationCity ?? null,
        listing.locationProvince ?? null,
        listing.status ?? 'available',
      ],
    );

    const created = rows[0];
    await insertImages(client, created.id, images);
    await upsertAttributes(client, created.id, attributes);

    return mapListing(created);
  });
}

/**
 * Update scalar fields, and optionally replace images / merge attributes.
 *
 * @param {object} options
 * @param {object} options.fields      camelCase fields to write
 * @param {?Array} options.images      when provided, replaces the whole gallery
 * @param {Array}  options.attributes  EAV rows to upsert
 * @param {Array}  options.removeAttributeIds definitions whose value should be cleared
 */
async function updateWithRelations(id, { fields = {}, images = null, attributes = [], removeAttributeIds = [] }) {
  return db.withTransaction(async (client) => {
    const sets = [];
    const params = [id];

    for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
      if (!(field in fields) || fields[field] === undefined) continue;
      params.push(fields[field]);
      sets.push(`${column} = $${params.length}`);
    }

    if (sets.length) {
      await client.query(`UPDATE listings SET ${sets.join(', ')} WHERE id = $1`, params);
    }

    if (images !== null) {
      await replaceImages(client, id, images);
    }

    await upsertAttributes(client, id, attributes);
    await deleteAttributes(client, id, removeAttributeIds);

    const { rows } = await client.query(
      `SELECT ${LISTING_COLUMNS} FROM listings l WHERE l.id = $1`,
      [id],
    );

    return mapListing(rows[0] ?? null);
  });
}

/** @param {{ includeRemoved?: boolean }} [options] */
async function findById(id, { includeRemoved = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${LISTING_COLUMNS}
       FROM listings l
      WHERE l.id = $1
        AND ($2::boolean OR l.status <> 'removed')`,
    [id, includeRemoved],
  );
  return mapListing(rows[0] ?? null);
}

/** Listing detail including seller, category, gallery and dynamic attributes. */
async function findByIdWithDetails(id, { includeRemoved = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${LISTING_COLUMNS},
            json_build_object(
              'id',   c.id,
              'name', c.name,
              'slug', c.slug,
              'path', c.path,
              'depth', c.depth
            ) AS category,
            json_build_object(
              'id',    u.id,
              'name',  u.name,
              'email', u.email,
              'phone', u.phone,
              'role',  u.role
            ) AS seller
       FROM listings l
       JOIN categories c ON c.id = l.category_id
       JOIN users      u ON u.id = l.seller_id
      WHERE l.id = $1
        AND ($2::boolean OR l.status <> 'removed')`,
    [id, includeRemoved],
  );

  const listing = mapListing(rows[0] ?? null);
  if (!listing) return null;

  const [images, attributes] = await Promise.all([findImages(id), findAttributes(id)]);

  return { ...listing, images, attributes };
}

/** Owner lookup for the ownership guard. */
async function findOwnerId(id) {
  const row = await db.queryOne('SELECT seller_id AS "sellerId" FROM listings WHERE id = $1', [id]);
  return row?.sellerId ?? null;
}

/** @returns {Promise<object|null>} the soft-deleted listing, or null if already removed */
async function softDelete(id) {
  const { rows } = await db.query(
    `UPDATE listings
        SET status = 'removed', deleted_at = NOW()
      WHERE id = $1
        AND status <> 'removed'
      RETURNING ${LISTING_COLUMNS_UNALIASED}`,
    [id],
  );
  return mapListing(rows[0] ?? null);
}

/** Fire-and-forget-ish counter used by the detail endpoint. */
async function incrementViewCount(id) {
  await db.query('UPDATE listings SET view_count = view_count + 1 WHERE id = $1', [id]);
}

async function countAll() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS total FROM listings');
  return rows[0].total;
}

module.exports = {
  LISTING_COLUMNS,
  FIELD_TO_COLUMN,
  COLUMN_TO_FIELD,
  COLUMN_BACKED_FIELDS,
  mapListing,
  createWithRelations,
  updateWithRelations,
  findById,
  findByIdWithDetails,
  findOwnerId,
  findImages,
  findAttributes,
  softDelete,
  incrementViewCount,
  countAll,
};

'use strict';

const { CATEGORY_TREE, MAKE_OPTIONS, CONDITION_OPTIONS, TRANSMISSION_OPTIONS, FUEL_OPTIONS, DRIVE_OPTIONS, WHEEL_OPTIONS, COLORS, CITIES } = require('./reference-data');

async function insertTree(client, node, parentId = null) {
  const { rows } = await client.query(
    `INSERT INTO categories (name, slug, parent_id, icon, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, slug, path, depth`,
    [node.name, node.slug, parentId, node.icon ?? null, node.sortOrder ?? 0],
  );

  const created = rows[0];
  const bySlug = new Map([[created.slug, created.id]]);
  const children = [];

  for (const child of node.children ?? []) {
    const childNode = await insertTree(client, child, created.id);
    children.push(childNode);
    for (const [slug, id] of childNode.bySlug) bySlug.set(slug, id);
  }

  return { ...created, children, bySlug };
}

function buildDefinitions(idsBySlug) {
  const definitions = [];

  const add = (categorySlug, definition) => {
    const categoryId = idsBySlug.get(categorySlug);
    if (!categoryId) throw new Error(`Unknown category slug "${categorySlug}" for filter "${definition.key}"`);
    definitions.push({ categoryId, ...definition });
  };

  const common = [
    { key: 'make', label: 'Make', type: 'enum', source: 'column', columnName: 'make', options: MAKE_OPTIONS, sortOrder: 1 },
    { key: 'condition', label: 'Condition', type: 'enum', source: 'column', columnName: 'condition', options: CONDITION_OPTIONS, sortOrder: 2 },
    { key: 'transmission', label: 'Transmission', type: 'enum', source: 'column', columnName: 'transmission', options: TRANSMISSION_OPTIONS, sortOrder: 3 },
    { key: 'color', label: 'Colour', type: 'enum', source: 'column', columnName: 'color', options: COLORS.map((c) => ({ value: c, label: c })), sortOrder: 4 },
    { key: 'location_city', label: 'City', type: 'enum', source: 'column', columnName: 'location_city', options: CITIES.map((c) => ({ value: c.city, label: c.city })), sortOrder: 5 },
    { key: 'location_province', label: 'Province', type: 'enum', source: 'column', columnName: 'location_province', options: [...new Set(CITIES.map((c) => c.province))].sort().map((p) => ({ value: p, label: p })), sortOrder: 6 },
    { key: 'price', label: 'Price', type: 'range', source: 'column', columnName: 'price', unit: 'IDR', minValue: 0, maxValue: 2_000_000_000, sortOrder: 7 },
    { key: 'year', label: 'Year', type: 'range', source: 'column', columnName: 'year', minValue: 1990, maxValue: 2030, sortOrder: 8 },
    { key: 'mileage_km', label: 'Mileage', type: 'range', source: 'column', columnName: 'mileage_km', unit: 'km', minValue: 0, maxValue: 500_000, sortOrder: 9 },
  ];
  for (const definition of common) add('vehicles', definition);

  add('cars', { key: 'fuel_type', label: 'Fuel Type', type: 'enum', source: 'column', columnName: 'fuel_type', options: FUEL_OPTIONS, sortOrder: 10 });
  add('cars', { key: 'engine_cc', label: 'Engine Displacement', type: 'range', source: 'attribute', unit: 'cc', minValue: 50, maxValue: 10_000, sortOrder: 11 });
  add('cars', { key: 'seat_count', label: 'Seats', type: 'range', source: 'attribute', unit: 'seats', minValue: 1, maxValue: 60, sortOrder: 12 });
  add('cars', { key: 'drive_type', label: 'Drivetrain', type: 'enum', source: 'attribute', options: DRIVE_OPTIONS, sortOrder: 13 });
  add('cars', { key: 'has_sunroof', label: 'Sunroof', type: 'boolean', source: 'attribute', sortOrder: 14 });

  add('motorcycles', { key: 'engine_cc', label: 'Engine Displacement', type: 'range', source: 'attribute', unit: 'cc', minValue: 50, maxValue: 2_500, sortOrder: 1 });
  add('motorcycles', { key: 'has_abs', label: 'ABS', type: 'boolean', source: 'attribute', sortOrder: 2 });

  add('commercial-vehicles', { key: 'fuel_type', label: 'Fuel Type', type: 'enum', source: 'column', columnName: 'fuel_type', options: FUEL_OPTIONS, sortOrder: 1 });
  add('commercial-vehicles', { key: 'payload_kg', label: 'Payload', type: 'range', source: 'attribute', unit: 'kg', minValue: 500, maxValue: 30_000, sortOrder: 2 });
  add('commercial-vehicles', { key: 'wheel_count', label: 'Wheels', type: 'enum', source: 'attribute', options: WHEEL_OPTIONS, sortOrder: 3 });

  return definitions;
}

async function seedCategories(client) {
  const idsBySlug = new Map();

  for (const root of CATEGORY_TREE) {
    const node = await insertTree(client, root);
    for (const [slug, id] of node.bySlug) idsBySlug.set(slug, id);
  }

  const definitions = buildDefinitions(idsBySlug);

  const params = [];
  const tuples = definitions.map((definition) => {
    const values = [
      definition.categoryId,
      definition.key,
      definition.label,
      definition.type,
      definition.source,
      definition.columnName ?? null,
      definition.unit ?? null,
      definition.options ? JSON.stringify(definition.options) : null,
      definition.minValue ?? null,
      definition.maxValue ?? null,
      definition.isFilterable ?? true,
      definition.isFacetable ?? true,
      definition.sortOrder ?? 0,
    ];
    const placeholders = values.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  await client.query(
    `INSERT INTO filter_definitions
       (category_id, key, label, type, source, column_name, unit, options,
        min_value, max_value, is_filterable, is_facetable, sort_order)
     VALUES ${tuples.join(', ')}`,
    params,
  );

  return { idsBySlug, rootId: idsBySlug.get('vehicles'), definitions: definitions.length };
}

module.exports = { seedCategories, buildDefinitions, insertTree };

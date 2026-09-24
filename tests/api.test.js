'use strict';

/**
 * End-to-end API tests.
 *
 * These run against a real PostgreSQL database and drive the HTTP surface, so
 * they cover routing, Zod validation, SQL, the dynamic filter validation and the
 * error envelope in one go.
 *
 * They skip themselves when no database is reachable - see tests/support/harness.js.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./support/harness');
const filtersRepository = require('../src/modules/filters/filters.repository');

describe('Automotive Marketplace API', () => {
  const ctx = {};
  let baseUrl;
  let close;
  let available = false;
  let skipReason = 'database not checked';

  before(async () => {
    try {
      const result = await harness.checkDatabase();
      available = result.available;
      skipReason = result.reason;
    } catch (error) {
      available = false;
      skipReason = error.message;
    }

    if (!available) return;

    const server = await harness.startTestServer();
    baseUrl = server.baseUrl;
    close = server.close;

    const suffix = harness.uniqueSuffix();

    // --- A seller ----------------------------------------------------------
    const seller = await harness.api(baseUrl, 'POST', '/api/v1/auth/register', {
      body: {
        email: `seller.${suffix}@automotive.test`,
        password: 'Rahasia123',
        name: 'Budi Santoso',
        phone: '+628123456789',
        role: 'seller',
      },
    });
    ctx.seller = seller.body.data.user;
    ctx.sellerToken = seller.body.data.token;

    // --- A second seller, used to prove the ownership guard ---------------
    const other = await harness.api(baseUrl, 'POST', '/api/v1/auth/register', {
      body: {
        email: `other.${suffix}@automotive.test`,
        password: 'Rahasia123',
        name: 'Siti Rahayu',
        role: 'seller',
      },
    });
    ctx.otherToken = other.body.data.token;

    // --- An admin ----------------------------------------------------------
    // Category writes are admin-only; promote the account directly because the
    // API deliberately has no "make me an admin" endpoint.
    const admin = await harness.api(baseUrl, 'POST', '/api/v1/auth/register', {
      body: {
        email: `admin.${suffix}@automotive.test`,
        password: 'Rahasia123',
        name: 'Platform Admin',
        role: 'seller',
      },
    });
    ctx.adminEmail = `admin.${suffix}@automotive.test`;

    await harness.db.query("UPDATE users SET role = 'admin' WHERE id = $1", [
      admin.body.data.user.id,
    ]);

    const adminLogin = await harness.api(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { email: ctx.adminEmail, password: 'Rahasia123' },
    });
    ctx.adminToken = adminLogin.body.data.token;

    // --- A small category tree --------------------------------------------
    // Vehicles > Cars > SUV, plus Vehicles > Motorcycles
    const vehicles = await harness.api(baseUrl, 'POST', '/api/v1/categories', {
      token: ctx.adminToken,
      body: { name: `Vehicles ${suffix}`, slug: `vehicles-${suffix}` },
    });
    ctx.vehicles = vehicles.body.data;

    const cars = await harness.api(baseUrl, 'POST', '/api/v1/categories', {
      token: ctx.adminToken,
      body: { name: 'Cars', slug: 'cars', parentId: ctx.vehicles.id },
    });
    ctx.cars = cars.body.data;

    const suv = await harness.api(baseUrl, 'POST', '/api/v1/categories', {
      token: ctx.adminToken,
      body: { name: 'SUV', slug: 'suv', parentId: ctx.cars.id },
    });
    ctx.suv = suv.body.data;

    const motorcycles = await harness.api(baseUrl, 'POST', '/api/v1/categories', {
      token: ctx.adminToken,
      body: { name: 'Motorcycles', slug: 'motorcycles', parentId: ctx.vehicles.id },
    });
    ctx.motorcycles = motorcycles.body.data;

    // --- Filter definitions ------------------------------------------------
    // Declared on Cars only. SUV inherits them through the materialized path,
    // while Motorcycles deliberately gets a different set - which is exactly how
    // "fuel type appears under Cars but not Motorcycles" is expressed.
    await filtersRepository.createDefinition({
      categoryId: ctx.cars.id,
      key: 'fuel_type',
      label: 'Fuel Type',
      type: 'enum',
      source: 'column',
      columnName: 'fuel_type',
      options: [
        { value: 'gasoline', label: 'Gasoline' },
        { value: 'diesel', label: 'Diesel' },
        { value: 'electric', label: 'Electric' },
        { value: 'hybrid', label: 'Hybrid' },
      ],
      sortOrder: 1,
    });

    await filtersRepository.createDefinition({
      categoryId: ctx.cars.id,
      key: 'transmission',
      label: 'Transmission',
      type: 'enum',
      source: 'column',
      columnName: 'transmission',
      options: [
        { value: 'manual', label: 'Manual' },
        { value: 'automatic', label: 'Automatic' },
        { value: 'cvt', label: 'CVT' },
      ],
      sortOrder: 2,
    });

    await filtersRepository.createDefinition({
      categoryId: ctx.cars.id,
      key: 'engine_cc',
      label: 'Engine Displacement',
      type: 'range',
      source: 'attribute',
      unit: 'cc',
      minValue: 50,
      maxValue: 10000,
      sortOrder: 3,
    });

    await filtersRepository.createDefinition({
      categoryId: ctx.cars.id,
      key: 'seat_count',
      label: 'Seats',
      type: 'range',
      source: 'attribute',
      unit: 'seats',
      minValue: 1,
      maxValue: 60,
      sortOrder: 4,
    });

    await filtersRepository.createDefinition({
      categoryId: ctx.cars.id,
      key: 'has_sunroof',
      label: 'Sunroof',
      type: 'boolean',
      source: 'attribute',
      sortOrder: 5,
    });

    // Motorcycles gets engine displacement but deliberately NOT fuel_type.
    await filtersRepository.createDefinition({
      categoryId: ctx.motorcycles.id,
      key: 'engine_cc',
      label: 'Engine Displacement',
      type: 'range',
      source: 'attribute',
      unit: 'cc',
      minValue: 50,
      maxValue: 2500,
      sortOrder: 1,
    });
  });

  after(async () => {
    if (close) await close();
    await harness.shutdown();
  });

  /** Skip helper so every test can bail out cleanly without a database. */
  function requireDatabase(t) {
    if (!available) {
      t.skip(`skipped: ${skipReason}`);
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  it('GET /health reports service status', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', '/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.checks.database.ok, true);
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  it('registers a user and returns a bearer token', (t) => {
    if (!requireDatabase(t)) return;
    assert.ok(ctx.seller.id);
    assert.ok(ctx.sellerToken);
    assert.equal(ctx.seller.role, 'seller');
    // The password hash must never be part of the payload.
    assert.equal(ctx.seller.passwordHash, undefined);
    assert.equal(ctx.seller.password_hash, undefined);
  });

  it('rejects a duplicate email with 409', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/auth/register', {
      body: { email: ctx.seller.email, password: 'Rahasia123', name: 'Duplicate' },
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'CONFLICT');
  });

  it('rejects a weak password with 422 and field-level details', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/auth/register', {
      body: { email: `weak.${harness.uniqueSuffix()}@automotive.test`, password: 'short', name: 'Weak' },
    });

    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(response.body.error.details));
    assert.ok(response.body.error.details.some((detail) => detail.field === 'password'));
  });

  it('logs in with valid credentials', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { email: ctx.seller.email, password: 'Rahasia123' },
    });

    assert.equal(response.status, 200);
    assert.ok(response.body.data.token);
    assert.equal(response.body.data.tokenType, 'Bearer');
  });

  it('rejects a wrong password with 401 and a generic message', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { email: ctx.seller.email, password: 'WrongPassword123' },
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.error.message, 'Invalid email or password');
  });

  it('does not reveal whether an unknown email exists', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { email: `nobody.${harness.uniqueSuffix()}@automotive.test`, password: 'Rahasia123' },
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.error.message, 'Invalid email or password');
  });

  it('protects /auth/me and returns the profile with a valid token', async (t) => {
    if (!requireDatabase(t)) return;

    const anonymous = await harness.api(baseUrl, 'GET', '/api/v1/auth/me');
    assert.equal(anonymous.status, 401);

    const authenticated = await harness.api(baseUrl, 'GET', '/api/v1/auth/me', {
      token: ctx.sellerToken,
    });
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.body.data.id, ctx.seller.id);
  });

  it('rejects a tampered token', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', '/api/v1/auth/me', {
      token: `${ctx.sellerToken}tampered`,
    });
    assert.equal(response.status, 401);
  });

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  it('derives path and depth for nested categories', (t) => {
    if (!requireDatabase(t)) return;

    assert.equal(ctx.vehicles.depth, 0);
    assert.equal(ctx.vehicles.path, `/${ctx.vehicles.id}/`);
    assert.equal(ctx.cars.depth, 1);
    assert.equal(ctx.cars.path, `/${ctx.vehicles.id}/${ctx.cars.id}/`);
    assert.equal(ctx.suv.depth, 2);
    assert.ok(ctx.suv.path.endsWith(`/${ctx.suv.id}/`));
  });

  it('refuses category creation without the admin role', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/categories', {
      token: ctx.sellerToken,
      body: { name: 'Sneaky', slug: `sneaky-${harness.uniqueSuffix()}` },
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  });

  it('returns the full tree, nested', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', '/api/v1/categories');
    assert.equal(response.status, 200);

    const root = response.body.data.find((node) => node.id === ctx.vehicles.id);
    assert.ok(root, 'the created root should be present');
    assert.equal(root.children.length, 2);

    const cars = root.children.find((node) => node.id === ctx.cars.id);
    assert.ok(cars);
    assert.equal(cars.children[0].id, ctx.suv.id);
  });

  it('returns a single category with its direct children', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', `/api/v1/categories/${ctx.cars.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.children.length, 1);
    assert.equal(response.body.data.children[0].slug, 'suv');
  });

  it('404s for an unknown category', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(
      baseUrl,
      'GET',
      '/api/v1/categories/00000000-0000-4000-8000-000000000000',
    );
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'NOT_FOUND');
  });

  it('moves a subtree and rewrites descendant paths', async (t) => {
    if (!requireDatabase(t)) return;

    // Move Cars (with SUV underneath) under Motorcycles, then put it back.
    const moved = await harness.api(baseUrl, 'PATCH', `/api/v1/categories/${ctx.cars.id}`, {
      token: ctx.adminToken,
      body: { parentId: ctx.motorcycles.id },
    });

    assert.equal(moved.status, 200);
    assert.equal(moved.body.data.depth, 2);
    assert.equal(moved.body.data.descendantsUpdated, 1);

    const suv = await harness.api(baseUrl, 'GET', `/api/v1/categories/${ctx.suv.id}`);
    assert.equal(suv.body.data.depth, 3, 'the descendant depth must shift with the subtree');
    assert.ok(suv.body.data.path.startsWith(moved.body.data.path));

    const restored = await harness.api(baseUrl, 'PATCH', `/api/v1/categories/${ctx.cars.id}`, {
      token: ctx.adminToken,
      body: { parentId: ctx.vehicles.id },
    });
    assert.equal(restored.body.data.depth, 1);
  });

  it('refuses to move a category into its own descendant', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'PATCH', `/api/v1/categories/${ctx.cars.id}`, {
      token: ctx.adminToken,
      body: { parentId: ctx.suv.id },
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'BAD_REQUEST');
  });

  // -------------------------------------------------------------------------
  // Listings - CRUD
  // -------------------------------------------------------------------------

  it('creates a listing with images and dynamic attributes', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/listings', {
      token: ctx.sellerToken,
      body: {
        categoryId: ctx.suv.id,
        title: '2019 Toyota Avanza 1.5 G - Full Service Record',
        description: 'Well maintained, single owner, non-accident.',
        make: 'Toyota',
        model: 'Avanza',
        year: 2019,
        mileageKm: 62000,
        price: 185000000,
        condition: 'used',
        transmission: 'automatic',
        fuelType: 'gasoline',
        color: 'Silver',
        locationCity: 'Jakarta',
        locationProvince: 'DKI Jakarta',
        images: [
          { url: 'https://images.example.com/avanza-1.jpg', isPrimary: true },
          { url: 'https://images.example.com/avanza-2.jpg' },
        ],
        // `fuel_type` is a column-backed definition, so it must land in the
        // column rather than the EAV table. The rest are attribute-backed.
        attributes: { fuel_type: 'gasoline', engine_cc: 1500, seat_count: 7, has_sunroof: false },
      },
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));

    ctx.listing = response.body.data;
    assert.equal(ctx.listing.status, 'available');
    assert.equal(ctx.listing.sellerId, ctx.seller.id);
    assert.equal(ctx.listing.images.length, 2);
    assert.equal(ctx.listing.images.filter((image) => image.isPrimary).length, 1);
    assert.equal(typeof ctx.listing.price, 'number');
    assert.ok(ctx.listing.category.slug === 'suv');
    assert.ok(ctx.listing.seller.email);
    assert.equal(ctx.listing.seller.passwordHash, undefined);
  });

  it('routes column-backed attributes to the column and others to the EAV table', async (t) => {
    if (!requireDatabase(t)) return;

    const byKey = Object.fromEntries(ctx.listing.attributes.map((a) => [a.key, a]));

    // fuel_type was sent through `attributes` but is a real column.
    assert.equal(ctx.listing.fuelType, 'gasoline');
    assert.equal(byKey.fuel_type, undefined, 'a column-backed filter must not create an EAV row');

    // The rest are stored as typed EAV values.
    assert.equal(byKey.engine_cc.value, 1500);
    assert.equal(byKey.engine_cc.type, 'range');
    assert.equal(byKey.engine_cc.unit, 'cc');
    assert.equal(byKey.seat_count.value, 7);
    assert.equal(byKey.has_sunroof.value, false);
    assert.equal(byKey.has_sunroof.type, 'boolean');
  });

  it('rejects fuel_type under Motorcycles, where Cars declares it', async (t) => {
    if (!requireDatabase(t)) return;

    // Motorcycles has no fuel_type definition and does not inherit Cars'
    // (they are siblings), so the attribute must be refused.
    const rejected = await harness.api(baseUrl, 'POST', '/api/v1/listings', {
      token: ctx.sellerToken,
      body: {
        categoryId: ctx.motorcycles.id,
        title: 'Honda Vario 160 - fuel type should not apply here',
        make: 'Honda',
        model: 'Vario 160',
        year: 2023,
        price: 28000000,
        attributes: { fuel_type: 'gasoline' },
      },
    });

    assert.equal(rejected.status, 422);
    assert.ok(rejected.body.error.details.some((d) => d.code === 'unknown_attribute'));

    // ...but engine_cc, which Motorcycles does declare, is accepted.
    const accepted = await harness.api(baseUrl, 'POST', '/api/v1/listings', {
      token: ctx.sellerToken,
      body: {
        categoryId: ctx.motorcycles.id,
        title: 'Honda Vario 160 CBS - low mileage',
        make: 'Honda',
        model: 'Vario 160',
        year: 2023,
        price: 28000000,
        attributes: { engine_cc: 160 },
      },
    });

    assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
    assert.equal(
      accepted.body.data.attributes.find((a) => a.key === 'engine_cc').value,
      160,
    );
  });

  it('rejects an unknown filter attribute with 422', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/listings', {
      token: ctx.sellerToken,
      body: {
        categoryId: ctx.suv.id,
        title: 'Listing with a bogus attribute',
        make: 'Honda',
        model: 'CR-V',
        year: 2021,
        price: 400000000,
        attributes: { not_a_real_filter: 'x' },
      },
    });

    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.ok(response.body.error.details.some((d) => d.code === 'unknown_attribute'));
  });

  it('rejects an out-of-range value for a range attribute', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/listings', {
      token: ctx.sellerToken,
      body: {
        categoryId: ctx.suv.id,
        title: 'Listing with an impossible engine size',
        make: 'Honda',
        model: 'CR-V',
        year: 2021,
        price: 400000000,
        attributes: { engine_cc: 999999 },
      },
    });

    assert.equal(response.status, 422);
    assert.ok(response.body.error.details.some((d) => d.code === 'out_of_range'));
  });

  it('rejects a listing with a missing required field', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/listings', {
      token: ctx.sellerToken,
      body: { categoryId: ctx.suv.id, title: 'No make or price' },
    });

    assert.equal(response.status, 422);
    const fields = response.body.error.details.map((detail) => detail.field);
    assert.ok(fields.includes('make'));
    assert.ok(fields.includes('price'));
  });

  it('rejects an unauthenticated create', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'POST', '/api/v1/listings', {
      body: { categoryId: ctx.suv.id, title: 'Anonymous', make: 'X', model: 'Y', year: 2020, price: 1 },
    });

    assert.equal(response.status, 401);
  });

  it('returns listing detail and increments the view counter', async (t) => {
    if (!requireDatabase(t)) return;

    const first = await harness.api(baseUrl, 'GET', `/api/v1/listings/${ctx.listing.id}`);
    assert.equal(first.status, 200);
    const initialViews = first.body.data.viewCount;

    const second = await harness.api(baseUrl, 'GET', `/api/v1/listings/${ctx.listing.id}`);
    assert.equal(second.body.data.viewCount, initialViews + 1);
    assert.equal(second.body.data.id, ctx.listing.id);
  });

  it('lets the owner patch a listing but not another seller', async (t) => {
    if (!requireDatabase(t)) return;

    const forbidden = await harness.api(baseUrl, 'PATCH', `/api/v1/listings/${ctx.listing.id}`, {
      token: ctx.otherToken,
      body: { price: 1 },
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, 'FORBIDDEN');

    const allowed = await harness.api(baseUrl, 'PATCH', `/api/v1/listings/${ctx.listing.id}`, {
      token: ctx.sellerToken,
      body: { price: 179500000, status: 'pending' },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.data.price, 179500000);
    assert.equal(allowed.body.data.status, 'pending');
  });

  it('replaces the gallery when images are supplied on update', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'PATCH', `/api/v1/listings/${ctx.listing.id}`, {
      token: ctx.sellerToken,
      body: { images: [{ url: 'https://images.example.com/replacement.jpg', isPrimary: true }] },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.images.length, 1);
    assert.equal(response.body.data.images[0].url, 'https://images.example.com/replacement.jpg');
  });

  it('soft-deletes a listing and hides it from reads', async (t) => {
    if (!requireDatabase(t)) return;

    const deleted = await harness.api(baseUrl, 'DELETE', `/api/v1/listings/${ctx.listing.id}`, {
      token: ctx.sellerToken,
    });

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.data.status, 'removed');
    assert.equal(deleted.body.meta.softDeleted, true);

    // Still present in the table (soft delete), but no longer readable.
    const read = await harness.api(baseUrl, 'GET', `/api/v1/listings/${ctx.listing.id}`);
    assert.equal(read.status, 404);

    const stillStored = await harness.db.query('SELECT status, deleted_at FROM listings WHERE id = $1', [
      ctx.listing.id,
    ]);
    assert.equal(stillStored.rows[0].status, 'removed');
    assert.ok(stillStored.rows[0].deleted_at);
  });

  it('returns 404 for an unknown listing', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(
      baseUrl,
      'GET',
      '/api/v1/listings/00000000-0000-4000-8000-000000000000',
    );
    assert.equal(response.status, 404);
  });

  it('returns the standard error envelope for an unknown route', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', '/api/v1/nope');
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // Browse, filtering and cursor pagination
  // -------------------------------------------------------------------------

  describe('browsing and cursor pagination', () => {
    // A dedicated category and a known set of listings, so assertions about
    // paging and filtering do not depend on anything created earlier.
    const suite = {};

    before(async () => {
      if (!available) return;

      const suffix = harness.uniqueSuffix();

      const category = await harness.api(baseUrl, 'POST', '/api/v1/categories', {
        token: ctx.adminToken,
        body: { name: 'Pagination Fixtures', slug: `pagination-${suffix}` },
      });
      suite.category = category.body.data;

      const child = await harness.api(baseUrl, 'POST', '/api/v1/categories', {
        token: ctx.adminToken,
        body: { name: 'Nested', slug: 'nested', parentId: suite.category.id },
      });
      suite.child = child.body.data;

      // An attribute-backed range filter, declared on the parent so the child
      // inherits it through the materialized path.
      await filtersRepository.createDefinition({
        categoryId: suite.category.id,
        key: 'engine_cc',
        label: 'Engine Displacement',
        type: 'range',
        source: 'attribute',
        unit: 'cc',
        minValue: 50,
        maxValue: 10000,
        sortOrder: 1,
      });

      // Six listings with strictly increasing prices, three in the parent
      // category and three in the child, so subtree scoping is observable.
      const prices = [100_000_000, 200_000_000, 300_000_000, 400_000_000, 500_000_000, 600_000_000];
      suite.ids = [];

      for (let index = 0; index < prices.length; index += 1) {
        const target = index < 3 ? suite.category.id : suite.child.id;
        // eslint-disable-next-line no-await-in-loop -- ordering must be deterministic
        const created = await harness.api(baseUrl, 'POST', '/api/v1/listings', {
          token: ctx.sellerToken,
          body: {
            categoryId: target,
            title: `Fixture listing number ${index} for pagination`,
            make: index % 2 === 0 ? 'Toyota' : 'Honda',
            model: `Model ${index}`,
            year: 2015 + index,
            mileageKm: 10_000 * (index + 1),
            price: prices[index],
            condition: 'used',
            fuelType: 'gasoline',
            // 1000, 1100, ... 1500 cc
            attributes: { engine_cc: 1000 + index * 100 },
          },
        });

        if (created.status !== 201) {
          throw new Error(`fixture creation failed: ${JSON.stringify(created.body)}`);
        }
        suite.ids.push(created.body.data.id);
      }
    });

    it('pages with a cursor without duplicating or skipping rows', async (t) => {
      if (!requireDatabase(t)) return;

      const seen = [];
      let cursor = null;
      let pages = 0;

      do {
        const url = `/api/v1/listings?categoryId=${suite.category.id}&limit=2${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`;
        // eslint-disable-next-line no-await-in-loop -- paging is inherently sequential
        const response = await harness.api(baseUrl, 'GET', url);

        assert.equal(response.status, 200);
        assert.ok(response.body.data.length <= 2);
        seen.push(...response.body.data.map((row) => row.id));
        cursor = response.body.pagination.nextCursor;
        pages += 1;

        assert.ok(pages <= 10, 'pagination must terminate');
      } while (cursor);

      assert.equal(seen.length, 6, 'all six fixtures should be returned exactly once');
      assert.equal(new Set(seen).size, 6, 'no row may appear on two pages');
    });

    it('includes subcategories by default and excludes them on request', async (t) => {
      if (!requireDatabase(t)) return;

      const withChildren = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/listings?categoryId=${suite.category.id}&limit=100`,
      );
      assert.equal(withChildren.body.data.length, 6);

      const withoutChildren = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/listings?categoryId=${suite.category.id}&includeSubcategories=false&limit=100`,
      );
      assert.equal(withoutChildren.body.data.length, 3);
    });

    it('sorts by price ascending across pages', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/listings?categoryId=${suite.category.id}&sort=price_asc&limit=100`,
      );

      const prices = response.body.data.map((row) => row.price);
      const sorted = [...prices].sort((a, b) => a - b);
      assert.deepEqual(prices, sorted);
    });

    it('filters by make, price range and year range', async (t) => {
      if (!requireDatabase(t)) return;

      const toyota = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/listings?categoryId=${suite.category.id}&make=Toyota&limit=100`,
      );
      assert.ok(toyota.body.data.length > 0);
      assert.ok(toyota.body.data.every((row) => row.make === 'Toyota'));

      const priced = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/listings?categoryId=${suite.category.id}&priceMin=250000000&priceMax=450000000&limit=100`,
      );
      assert.ok(priced.body.data.every((row) => row.price >= 250_000_000 && row.price <= 450_000_000));
      assert.equal(priced.body.data.length, 2);

      const year = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/listings?categoryId=${suite.category.id}&yearMin=2020&limit=100`,
      );
      assert.ok(year.body.data.every((row) => row.year >= 2020));
    });

    it('filters on a dynamic range attribute', async (t) => {
      if (!requireDatabase(t)) return;

      // Fixtures carry engine_cc of 1000..1500. Asking for >= 1200 must return
      // exactly the three listings created with 1200, 1300 and 1400 ... plus 1500.
      const response = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/listings?categoryId=${suite.category.id}&limit=100&attr%5Bengine_cc%5D%5Bmin%5D=1200`,
      );

      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.data.length, 4);
    });

    it('filters on a dynamic range attribute with an upper bound', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/listings?categoryId=${suite.category.id}&limit=100&attr%5Bengine_cc%5D%5Bmax%5D=1100`,
      );

      assert.equal(response.status, 200);
      assert.equal(response.body.data.length, 2);
    });

    it('rejects an invalid sort key with 422', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await harness.api(baseUrl, 'GET', '/api/v1/listings?sort=drop_table');
      assert.equal(response.status, 422);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    });

    it('rejects a cursor issued for a different sort order', async (t) => {
      if (!requireDatabase(t)) return;

      const first = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/listings?categoryId=${suite.category.id}&sort=newest&limit=2`,
      );
      const cursor = first.body.pagination.nextCursor;
      assert.ok(cursor);

      const mismatched = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/listings?categoryId=${suite.category.id}&sort=price_asc&limit=2&cursor=${encodeURIComponent(cursor)}`,
      );

      assert.equal(mismatched.status, 400);
      assert.equal(mismatched.body.error.code, 'BAD_REQUEST');
    });

    it('serves GET /categories/:id/listings with the same filters', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await harness.api(
        baseUrl,
        'GET',
        `/api/v1/categories/${suite.category.id}/listings?limit=100`,
      );

      assert.equal(response.status, 200);
      assert.equal(response.body.data.length, 6);
      assert.equal(response.body.meta.category.id, suite.category.id);
    });

    it('404s when the category in the scope does not exist', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await harness.api(
        baseUrl,
        'GET',
        '/api/v1/listings?categoryId=00000000-0000-4000-8000-000000000000',
      );
      assert.equal(response.status, 404);
    });
  });
});

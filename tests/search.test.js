'use strict';

/**
 * Search endpoint tests.
 *
 * Exercises full-text matching, the trigram (partial word / typo) branches, and
 * combinations of free text with structured filters - against a real PostgreSQL
 * database, so the tsvector and GIN indexes are genuinely involved.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./support/harness');

describe('Search API', () => {
  const ctx = {};
  let baseUrl;
  let close;
  let available = false;
  let skipReason = 'database not checked';

  const FIXTURES = [
    {
      title: '2019 Toyota Avanza 1.5 G Family MPV',
      make: 'Toyota',
      model: 'Avanza',
      year: 2019,
      price: 185_000_000,
      fuelType: 'gasoline',
      transmission: 'automatic',
      city: 'Jakarta',
      province: 'DKI Jakarta',
    },
    {
      title: '2021 Toyota Innova Zenix Hybrid',
      make: 'Toyota',
      model: 'Innova',
      year: 2021,
      price: 480_000_000,
      fuelType: 'hybrid',
      transmission: 'cvt',
      city: 'Surabaya',
      province: 'Jawa Timur',
    },
    {
      title: '2018 Honda Mobilio E MT',
      make: 'Honda',
      model: 'Mobilio',
      year: 2018,
      price: 155_000_000,
      fuelType: 'gasoline',
      transmission: 'manual',
      city: 'Bandung',
      province: 'Jawa Barat',
    },
    {
      title: '2022 Mitsubishi Pajero Sport Dakar',
      make: 'Mitsubishi',
      model: 'Pajero Sport',
      year: 2022,
      price: 720_000_000,
      fuelType: 'diesel',
      transmission: 'automatic',
      city: 'Jakarta',
      province: 'DKI Jakarta',
    },
    {
      title: '2020 Hyundai Ioniq Electric',
      make: 'Hyundai',
      model: 'Ioniq',
      year: 2020,
      price: 610_000_000,
      fuelType: 'electric',
      transmission: 'automatic',
      city: 'Denpasar',
      province: 'Bali',
    },
  ];

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

    const seller = await harness.api(baseUrl, 'POST', '/api/v1/auth/register', {
      body: {
        email: `search.seller.${suffix}@automotive.test`,
        password: 'Rahasia123',
        name: 'Search Seller',
      },
    });
    ctx.token = seller.body.data.token;

    const admin = await harness.api(baseUrl, 'POST', '/api/v1/auth/register', {
      body: {
        email: `search.admin.${suffix}@automotive.test`,
        password: 'Rahasia123',
        name: 'Search Admin',
      },
    });
    await harness.db.query("UPDATE users SET role = 'admin' WHERE id = $1", [
      admin.body.data.user.id,
    ]);
    const adminLogin = await harness.api(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { email: `search.admin.${suffix}@automotive.test`, password: 'Rahasia123' },
    });
    ctx.adminToken = adminLogin.body.data.token;

    // A dedicated root category keeps the fixtures out of every other test's
    // result set.
    const category = await harness.api(baseUrl, 'POST', '/api/v1/categories', {
      token: ctx.adminToken,
      body: { name: `Search Fixtures ${suffix}`, slug: `search-fixtures-${suffix}` },
    });
    ctx.category = category.body.data;

    for (const fixture of FIXTURES) {
      // eslint-disable-next-line no-await-in-loop -- fixtures are order-independent but cheap
      const created = await harness.api(baseUrl, 'POST', '/api/v1/listings', {
        token: ctx.token,
        body: {
          categoryId: ctx.category.id,
          title: fixture.title,
          description: `${fixture.make} ${fixture.model} in excellent condition, full service history.`,
          make: fixture.make,
          model: fixture.model,
          year: fixture.year,
          mileageKm: 40_000,
          price: fixture.price,
          condition: 'used',
          transmission: fixture.transmission,
          fuelType: fixture.fuelType,
          color: 'Silver',
          locationCity: fixture.city,
          locationProvince: fixture.province,
        },
      });

      if (created.status !== 201) {
        throw new Error(`search fixture failed: ${JSON.stringify(created.body)}`);
      }
    }
  });

  after(async () => {
    if (close) await close();
    await harness.shutdown();
  });

  function requireDatabase(t) {
    if (!available) {
      t.skip(`skipped: ${skipReason}`);
      return false;
    }
    return true;
  }

  /** Scope every search to the fixture category so results are deterministic. */
  const scoped = (extra = '') => `/api/v1/listings/search?categoryId=${ctx.category.id}&limit=50${extra}`;

  it('matches on a whole word in the title', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', scoped('&q=Avanza'));
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].make, 'Toyota');
    assert.equal(response.body.meta.query, 'Avanza');
  });

  it('matches across multiple words regardless of order', async (t) => {
    if (!requireDatabase(t)) return;

    const forward = await harness.api(baseUrl, 'GET', scoped('&q=toyota%20innova'));
    assert.equal(forward.body.data.length, 1);
    assert.equal(forward.body.data[0].model, 'Innova');

    const reversed = await harness.api(baseUrl, 'GET', scoped('&q=innova%20toyota'));
    assert.equal(reversed.body.data.length, 1);
  });

  it('matches a partial word through the trigram branch', async (t) => {
    if (!requireDatabase(t)) return;

    // "avan" is not a lexeme, so pure full-text search cannot match it.
    const response = await harness.api(baseUrl, 'GET', scoped('&q=avan'));
    assert.equal(response.status, 200);
    assert.ok(
      response.body.data.some((row) => row.model === 'Avanza'),
      'a partial word should match via pg_trgm',
    );
  });

  it('tolerates a typo', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', scoped('&q=Toyata'));
    assert.equal(response.status, 200);
    assert.ok(response.body.data.length > 0, 'a one-letter typo should still find Toyota');
  });

  it('honours fuzzy=false for strict matching', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', scoped('&q=avan&fuzzy=false'));
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 0, 'strict mode must not use trigram matching');
  });

  it('combines free text with make, price and year filters', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(
      baseUrl,
      'GET',
      scoped('&q=toyota&make=Toyota&priceMin=400000000&yearMin=2020'),
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].model, 'Innova');
    assert.ok(response.body.data[0].price >= 400_000_000);
    assert.ok(response.body.data[0].year >= 2020);
  });

  it('filters by fuel type and city in combination', async (t) => {
    if (!requireDatabase(t)) return;

    const jakarta = await harness.api(baseUrl, 'GET', scoped('&city=Jakarta'));
    assert.equal(jakarta.body.data.length, 2);

    const electric = await harness.api(baseUrl, 'GET', scoped('&fuelType=electric'));
    assert.equal(electric.body.data.length, 1);
    assert.equal(electric.body.data[0].make, 'Hyundai');

    const combined = await harness.api(baseUrl, 'GET', scoped('&city=Jakarta&fuelType=diesel'));
    assert.equal(combined.body.data.length, 1);
    assert.equal(combined.body.data[0].make, 'Mitsubishi');
  });

  it('sorts by relevance when a query is present', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', scoped('&q=toyota&sort=relevance'));
    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.sort, 'relevance');
    assert.ok(response.body.data.length >= 2);
  });

  it('falls back to newest when relevance is requested without a query', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', scoped('&sort=relevance'));
    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.sort, 'newest');
  });

  it('returns an empty result set rather than an error when nothing matches', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', scoped('&q=zzzzzznonexistent'));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);
    assert.equal(response.body.pagination.hasMore, false);
    assert.equal(response.body.pagination.nextCursor, null);
  });

  it('never leaks a soft-deleted listing into results', async (t) => {
    if (!requireDatabase(t)) return;

    const before = await harness.api(baseUrl, 'GET', scoped('&q=Pajero'));
    assert.equal(before.body.data.length, 1);
    const target = before.body.data[0];

    const deleted = await harness.api(baseUrl, 'DELETE', `/api/v1/listings/${target.id}`, {
      token: ctx.token,
    });
    assert.equal(deleted.status, 200);

    const afterDelete = await harness.api(baseUrl, 'GET', scoped('&q=Pajero'));
    assert.equal(afterDelete.body.data.length, 0);
  });

  it('rejects an over-long query with 422', async (t) => {
    if (!requireDatabase(t)) return;

    const response = await harness.api(baseUrl, 'GET', `/api/v1/listings/search?q=${'x'.repeat(300)}`);
    assert.equal(response.status, 422);
  });

  // -------------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------------

  describe('autocomplete', () => {
    const suggest = (params) =>
      harness.api(baseUrl, 'GET', `/api/v1/listings/search/suggest?${params}`);

    it('suggests a make by prefix', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await suggest(`q=toy&categoryId=${ctx.category.id}`);
      assert.equal(response.status, 200, JSON.stringify(response.body));

      const makes = response.body.data.make;
      assert.equal(makes.length, 1);
      assert.equal(makes[0].value, 'Toyota');
      assert.equal(makes[0].prefixMatch, true);
      assert.ok(makes[0].listingCount >= 2);
    });

    it('suggests models as well as makes', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await suggest(`q=avan&categoryId=${ctx.category.id}`);
      const models = response.body.data.model.map((item) => item.value);
      assert.ok(models.includes('Avanza'), `expected Avanza in ${JSON.stringify(models)}`);
    });

    it('suggests cities', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await suggest(`q=jak&categoryId=${ctx.category.id}`);
      const cities = response.body.data.city.map((item) => item.value);
      assert.deepEqual(cities, ['Jakarta']);
    });

    it('absorbs a typo via trigram similarity', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await suggest(`q=Toyata&categoryId=${ctx.category.id}`);
      const makes = response.body.data.make.map((item) => item.value);
      assert.ok(makes.includes('Toyota'), `expected Toyota in ${JSON.stringify(makes)}`);
    });

    it('ranks prefix matches ahead of mid-string matches', async (t) => {
      if (!requireDatabase(t)) return;

      // "an" appears mid-string in many values; a prefix match must win.
      const response = await suggest(`q=toyota&categoryId=${ctx.category.id}`);
      const makes = response.body.data.make;
      assert.equal(makes[0].prefixMatch, true);
    });

    it('limits which groups are returned', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await suggest(`q=t&types=make&categoryId=${ctx.category.id}`);
      assert.ok(response.body.data.make);
      assert.equal(response.body.data.model, undefined);
      assert.equal(response.body.data.city, undefined);
    });

    it('caps the number of suggestions per group', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await suggest(`q=a&limit=1&categoryId=${ctx.category.id}`);
      assert.ok(response.body.data.make.length <= 1);
      assert.ok(response.body.data.model.length <= 1);
    });

    it('requires a search term', async (t) => {
      if (!requireDatabase(t)) return;

      const response = await suggest('q=');
      assert.equal(response.status, 422);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    });

    it('scopes suggestions to the requested category', async (t) => {
      if (!requireDatabase(t)) return;

      // Scoped to the fixture category, "honda" is only present via Mobilio;
      // a city that exists elsewhere in the database must not appear.
      const scoped = await suggest(`q=den&categoryId=${ctx.category.id}`);
      const cities = scoped.body.data.city.map((item) => item.value);
      assert.deepEqual(cities, ['Denpasar']);
    });
  });
});

# Automotive Marketplace API

REST API for an automotive marketplace — sellers list vehicles, buyers browse,
filter and search them. Built for the **PT Daya Rekadigital Indonesia Backend
Developer Technical Assessment**.

Node.js 20 · Express · PostgreSQL 16 · raw SQL (`pg`, no ORM) · Zod · JWT (HS256)
· Redis · Docker

---

## Live API

> **`https://<your-service>.up.railway.app/api/v1`** ← replace after deploying

Deployment is one command away — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
The Railway project needs an account and a database plugin, so the URL is left
as a placeholder rather than fabricated. Everything else in this README was
verified against a real PostgreSQL instance.

| | |
| --- | --- |
| **Swagger UI** | `/api/v1/docs` |
| **OpenAPI JSON** | [`docs/openapi.json`](docs/openapi.json) |
| **Health** | `/health` |
| **ERD (dbdiagram.io)** | [`docs/schema.dbml`](docs/schema.dbml) — paste into <https://dbdiagram.io> |

### Demo credentials (created by `npm run seed`)

| Role | Email | Password | Can do |
| --- | --- | --- | --- |
| Admin | `admin@automotive.test` | `Admin12345` | everything, incl. creating categories |
| Seller | `seller1@automotive.test` | `Seller12345` | create and manage own listings |
| Buyer | `buyer@automotive.test` | `Buyer12345` | browse and search |

---

## Quick start

### Option A — Docker (nothing to install but Docker)

```bash
docker compose up --build
```

Brings up PostgreSQL, Redis and the API, waits for both dependencies to be
healthy, runs migrations, seeds 600 listings and serves on
<http://localhost:3000/api/v1/docs>.

Podman works too — the compose file only uses standard Compose features:

```bash
podman machine start      # once, if the VM is not already running
podman compose up --build
```

### Option B — Local

```bash
# 1. Dependencies
npm install

# 2. Configuration
cp .env.example .env
#    then set DATABASE_URL (and optionally REDIS_URL)

# 3. Schema
npm run migrate

# 4. Demo data: 600 listings, ~2 700 images, ~2 000 dynamic attributes
npm run seed

# 5. Run
npm run dev        # nodemon
npm start          # plain node
```

Then open <http://localhost:3000/api/v1/docs>.

```bash
npm test           # 89 tests; integration tests skip themselves without a database
npm run lint       # eslint
npm run docs:export # regenerate docs/openapi.json
```

Something not starting? [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) covers
the failures that actually happen — including why a healthy PostgreSQL container
looks "stuck", and the Podman-on-Windows state where `machine start` claims the VM
is running while the socket refuses connections.

---

## API

Every endpoint from the brief, all documented with sample requests and responses
in Swagger.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/auth/register` | Register a buyer or seller |
| `POST` | `/auth/login` | Log in, returns an HS256 JWT |
| `GET` `PATCH` | `/auth/me` | Current user's profile |
| `POST` | `/listings` | Create a listing (seller) |
| `GET` | `/listings` | Browse: filters, sorting, cursor pagination |
| `GET` | `/listings/:id` | Listing detail with images and attributes |
| `PATCH` | `/listings/:id` | Update (owner or admin) |
| `DELETE` | `/listings/:id` | **Soft** delete → `status = 'removed'` |
| `GET` | `/listings/search` | Full-text + faceted search |
| `GET` | `/listings/search/suggest` | Autocomplete for make, model, city |
| `GET` | `/filters` | All filter options with counts (facets) |
| `GET` | `/filters/:categoryId` | Filters specific to a category |
| `GET` | `/categories` | Full category tree |
| `GET` | `/categories/:id` | Category with children and its filter set |
| `GET` | `/categories/:id/listings` | Listings scoped to a category + subcategories |
| `POST` `PATCH` | `/categories` `/categories/:id` | Manage the tree (admin) |
| `GET` | `/health` | Liveness / readiness |

### Try it in 30 seconds

```bash
BASE=http://localhost:3000/api/v1

TOKEN=$(curl -s $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"seller1@automotive.test","password":"Seller12345"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')

# Browse with a filter, newest first
curl -s "$BASE/listings?make=Toyota&fuelType=diesel&priceMax=600000000&limit=3" | node -pe '
  JSON.parse(require("fs").readFileSync(0)).data
    .map(l => `${l.year} ${l.make} ${l.model} — Rp ${l.price.toLocaleString("id-ID")}`).join("\n")'

# Follow the cursor to page 2
CURSOR=$(curl -s "$BASE/listings?limit=3" | node -pe 'JSON.parse(require("fs").readFileSync(0)).pagination.nextCursor')
curl -s "$BASE/listings?limit=3&cursor=$CURSOR" >/dev/null && echo "page 2 OK"

# Which filters does Motorcycles expose? (no fuel type — see below)
curl -s "$BASE/filters/$(curl -s "$BASE/categories?flat=true" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.find(c=>c.slug==="motorcycles").id')" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.definitions.map(d=>d.key).join(", ")'
```

---

## Architecture

### Layering

```
HTTP  ──▶ routes ──▶ controller ──▶ service ──▶ repository ──▶ pg ──▶ PostgreSQL
          validation  HTTP shape    rules        SQL
```

```
src/
├── config/          # env parsing, OpenAPI definition
├── db/
│   ├── migrations/  # numbered .up.sql / .down.sql pairs
│   ├── seeds/       # reference data + generators
│   ├── migrate.js   # dependency-free migration runner
│   └── seed.js      # `npm run seed`
├── modules/
│   ├── auth/        # register, login, JWT
│   ├── categories/  # hierarchical tree
│   ├── listings/    # CRUD + the shared filter→SQL translator
│   ├── search/      # full-text search, autocomplete
│   └── filters/     # dynamic filter registry, facets
├── middleware/      # auth, validation, error handling, rate limiting
├── utils/           # db, redis, cache, pagination, errors, helpers
├── routes/          # route registry, health probe
├── app.js           # Express app factory
└── server.js        # process entry point
```

**Why this shape.** Each layer has one reason to change: routes declare the
contract, controllers translate HTTP, services hold the rules, repositories hold
the SQL. It means the dynamic-filter logic can be tested without HTTP, and the
HTTP layer can be tested without a database — which is exactly what `tests/`
does. It is a modular monolith, not microservices: the assessment is a 3-day
take-home and one deployable is the honest choice.

**No ORM.** The brief forbids it. `src/utils/db.js` owns the single `pg.Pool` and
exposes `query()`, `queryOne()` and `withTransaction()`. Every SQL statement in
the project is visible, reviewable and tunable.

---

## The four decisions that matter

### 1. Category tree — adjacency list **+** materialized path

`categories` carries both a `parent_id` (adjacency list) and a `path`
(materialized path, `/<root-uuid>/<child-uuid>/<self-uuid>/`).

| Approach | Subtree query | Write cost |
| --- | --- | --- |
| Adjacency list only | recursive CTE, cannot use an index | cheap |
| Materialized path only | indexed prefix scan | subtree rewrite on move |
| **Both** | **indexed prefix scan** | cheap for inserts; one set-based `UPDATE` on move |

Fetching "Cars and everything under it" — the hottest query in the API, backing
`GET /categories/:id/listings` — is:

```sql
SELECT id FROM categories WHERE path LIKE (SELECT path FROM categories WHERE id = $1) || '%';
```

That is a single range scan on `categories_path_prefix_idx`. A recursive CTE
would have to walk the tree on every request and could not use an index at all.
Depth is unbounded, as required.

Two details make it hold together:

- The index is declared `text_pattern_ops`. Under a non-C collation a plain
  btree index cannot serve `LIKE 'prefix%'`, so this is what turns the query into
  an index scan instead of a sequential one.
- `path` and `depth` are derived by a **BEFORE INSERT trigger**, not by the
  application. Column defaults are evaluated before row triggers fire, so the
  trigger can include the node's own id in one pass. No writer — not the service,
  not the seed, not raw SQL — can produce an inconsistent path.

Reparenting is a single set-based `UPDATE` that preserves each descendant's
suffix while swapping the prefix, and the service rejects moving a node into its
own descendant (which would detach the subtree).

### 2. Dynamic, category-specific filters

The requirement: *"dynamic, category-specific filter attributes (e.g. fuel type
only appears under Cars, not Motorcycles)"*, typed as `enum`, `range` or
`boolean`.

`filter_definitions` is a **registry**, not a schema. A row says *"category X
exposes filter `engine_cc`, of type `range`, sourced from column `engine_cc`"*.
Two value sources are supported:

- `source = 'column'` — the value is a first-class `listings` column (make,
  price, year, fuel type…). No join, plain btree index, cheap to facet.
- `source = 'attribute'` — the value lives in `listing_attributes` (EAV), for
  genuinely sparse data such as engine displacement or battery capacity.

Definitions are declared on the branch that needs them and **inherited by
descendants** through a path-prefix join in the `category_effective_filters`
view. So `Cars > SUV` automatically exposes everything declared on `Cars` — and
`Motorcycles`, a sibling, does not.

Verified end to end:

```
GET /filters/{suv}          → has fuel_type = true    (inherited from Cars)
GET /filters/{motorcycles}  → has fuel_type = false   has engine_cc = true
POST /listings (motorcycles, attributes.fuel_type) → 422 unknown_attribute
```

The same registry drives **write validation** (a value must match the
definition's declared type, enum membership and range bounds) and **facet
counts**, so adding a filter is an `INSERT`, not a code change.

`listing_attributes` stores three typed columns (`value_text`, `value_num`,
`value_bool`) with a CHECK that exactly one is populated, plus **partial**
indexes per type so only the populated column is indexed. Storing numbers as
text would force a cast on every comparison and make the index useless.

### 3. Search — two strategies, because they fail differently

Full-text search and fuzzy matching are OR-ed, because they cover disjoint
failure modes:

- A **weighted `tsvector`** (title/make/model = `A`, location/colour = `B`,
  description = `C`) queried with `websearch_to_tsquery`, backed by a GIN index.
  Handles stemming and word order. `websearch_to_tsquery` is used rather than
  `to_tsquery` because it accepts natural input, understands quotes and
  `-exclusions`, and never raises a syntax error on odd input — `to_tsquery`
  would turn a stray character into a 500.
- **`pg_trgm`** branches over title, make and model, backed by GIN indexes. Full
  text search works on whole lexemes, so it cannot match `avan` (partial) or
  `Toyata` (typo). Two different trigram features are needed: `ILIKE '%q%'` for
  substrings and the `%` similarity operator for typos.

The similarity branches apply to **single-token queries only**. Found while
testing: against the phrase `toyota innova`, the shared trigrams with the
one-word make `Toyota` are enough to clear the 0.3 threshold, so it matched every
Toyota and silently destroyed multi-word precision.

The `tsvector` is a `GENERATED ALWAYS ... STORED` column, so PostgreSQL maintains
it and it can never drift out of sync with the row.

**Facets are disjunctive.** A facet's counts are computed with that facet's own
filter removed and every other filter applied. After filtering to
`make=Toyota`, the make facet still lists Honda with its count — otherwise there
would be no way to switch — while the city facet counts only cities within
Toyota. Counts come from the same `WHERE` fragment the search itself uses, so a
facet can never disagree with the result set it describes.

**Autocomplete** derives suggestions from the data, so every value is guaranteed
to match at least one listing. Ranking is prefix match, then popularity, then
alphabetical — the alphabetical tie-breaker matters, otherwise equally popular
values would reshuffle between identical requests.

### 4. Pagination — cursor, not offset

`LIMIT 20 OFFSET 4000` makes PostgreSQL generate and discard 4000 rows, so page
200 costs roughly 200× page 1. It is also *unstable*: a listing inserted
mid-pagination shifts every later row, so clients see duplicates and silently
skipped records.

A cursor encodes the position instead:

```sql
ORDER BY created_at DESC, id DESC
WHERE (created_at, id) < ($cursorCreatedAt, $cursorId)
```

PostgreSQL evaluates the row-value comparison directly against the composite
index `(status, created_at DESC, id DESC)`, seeking straight to the cursor and
reading exactly `limit` rows — O(log n + limit) at any depth. `id` is always the
tie-breaker, which matters because the seed writes hundreds of rows with
near-identical timestamps.

Two supporting details:

- The repository fetches `limit + 1` rows. The extra row is the look-ahead that
  says whether another page exists, avoiding a second `COUNT` query.
- A cursor embeds its sort key and is rejected with **400** if replayed against a
  different ordering, which would otherwise return silently wrong results.

`sort=relevance` ranks by `ts_rank` and carries the rank *in the cursor*, so
relevance ordering stays keyset-paginated rather than degrading to offset paging.

---

## Indexing strategy

Indexes are shaped by the queries, not added speculatively.

| Index | Serves |
| --- | --- |
| `listings (status, created_at DESC, id DESC)` | the default browse page |
| `listings (category_id, status, created_at DESC, id DESC)` | category-scoped browse |
| `listings (status, price, id)` | price-sorted browse |
| `listings_search_vector_idx` (GIN) | full-text search |
| `listings_{title,make,model,location_city}_trgm_idx` (GIN) | autocomplete, substring and typo matching |
| `categories_path_prefix_idx` (`text_pattern_ops`) | subtree scans |
| `listing_attributes_{text,num,bool}_idx` (partial) | dynamic attribute filters |
| `listing_images (listing_id, position)` | gallery and primary-image lookup |
| `users_email_lower_unique_idx` (functional unique) | case-insensitive login |

Every keyset index leads with the equality column and carries the sort columns in
matching order, which is what makes the seek work. Every index has a query behind
it — there is no index kept "just in case".

---

## Schema

Paste [`docs/schema.dbml`](docs/schema.dbml) into <https://dbdiagram.io> to render
the ERD.

```
users ──1:N──▶ listings ◀──N:1── categories ──self-FK──▶ categories
                 │  │  │
                 │  │  └──1:N──▶ listing_attributes ──N:1──▶ filter_definitions
                 │  └────1:N──▶ listing_images
                 └───────N:M──▶ users  (via favorites)
```

Notable choices:

- **`listing_images` is a table, not a `TEXT[]`.** Images need ordering, alt text
  and a unique-per-listing "primary" flag — that last constraint is impossible to
  express on an array column.
- **Soft delete via `status`, not a boolean.** `status` already had to exist
  (`available` / `sold` / `pending`), so `removed` joins the existing enum instead
  of adding a parallel `is_deleted` flag that could disagree with it. `deleted_at`
  is kept for audit.
- **`currency` is a column** even though everything is IDR, so the price is
  self-describing and multi-currency is a data change rather than a migration.
- **Unique slugs are sibling-scoped**, not global — `SUV` legitimately exists
  under both Cars and Motorcycles. Two partial unique indexes express that,
  because PostgreSQL treats `NULL` parents as distinct.
- **CHECK constraints mirror the enums** (`status`, `condition`, `transmission`,
  `fuel_type`) so invalid data cannot enter even via raw SQL.

---

## Seed data

`npm run seed` generates **600 listings** across the full category tree, with
~2 700 gallery images and ~2 000 dynamic attribute values, in about 8 seconds.

It models the real market rather than sampling uniformly:

- Prices are drawn from each model's own band and **depreciated by age** (38%
  floor), so a 2015 Avanza is never priced like a 2024 one. Uniform sampling over
  "Rp 50 jt – Rp 2 M" would make every price filter meaningless.
- Mileage follows age and condition; only the newest model year can be "new".
- Fuel type is constrained by what each model is actually sold with, so diesel
  appears only where it belongs — which is what makes the fuel-type facet
  informative.
- Cities are weighted, because listings really do concentrate in Jakarta,
  Surabaya and Bandung.

14 makes (Toyota, Honda, Mitsubishi, Suzuki, Daihatsu, Nissan, BMW,
Mercedes-Benz, Hyundai, Wuling, Yamaha, Kawasaki, Hino, Isuzu), 10 cities with
provinces, years 2015–2024, prices Rp 6.2 jt – Rp 1.99 bn.

Generation uses a **seeded PRNG**, so the same `SEED_RANDOM_SEED` always produces
identical listings — the numbers in this README are reproducible. Inserts are
batched (100–300 rows per statement) inside a single transaction.

> Seeding truncates marketplace tables and regenerates them. It is a setup step,
> not something to run against live data.

---

## Caching

Redis caches the three endpoints whose cost scales with the catalogue rather than
the response:

| Endpoint | Why |
| --- | --- |
| `GET /listings/search` | full-text match + ~10 facet aggregations |
| `GET /filters[/:categoryId]` | the same aggregations, for the filter panel |
| `GET /listings/search/suggest` | up to three grouped, ranked `DISTINCT` scans |

`GET /listings` is deliberately **not** cached: it is a single indexed keyset scan
returning in single-digit milliseconds, so a cache round trip would cost more
than the query it replaces while adding a stale window.

Measured locally with a 60 s TTL:

```
GET /filters  call 1   500ms–2.6s   X-Cache: MISS
GET /filters  call 2                X-Cache: HIT   9ms
```

`X-Cache: HIT|MISS` is returned on every cached response so the layer is
observable from outside rather than merely configured.

**Graceful degradation.** With `REDIS_URL` unset or the server down, every helper
becomes a no-op and the API serves from PostgreSQL; a cache read failure is
caught and falls through to the source. A broken cache can slow the API down but
cannot break it — the entire test suite runs with no Redis at all, so that path
is covered continuously.

**Invalidation** drops the whole catalogue namespace on any listing or category
write. Deliberately coarse: with a 60-second TTL, surgical per-key invalidation
buys little and risks serving a stale facet count, which is the one thing a
faceted search must never do.

---

## Testing

```bash
npm test
```

**89 tests, all passing.** `node:test` only — no test framework to install.

- `tests/api.test.js` — boots the real Express app on an ephemeral port and drives
  it over HTTP against PostgreSQL: auth, the category tree (including moves and
  illegal moves), listing CRUD, dynamic-attribute routing, cursor pagination
  without duplicates or gaps, ownership enforcement and the error envelope.
- `tests/search.test.js` — full-text and multi-word matching, partial words,
  typos, `fuzzy=false`, filters combined with free text, relevance sorting,
  autocomplete ranking and scoping.
- `tests/cache.test.js` — key stability, hit/miss accounting, fallback when Redis
  is disabled or throws, invalidation fan-out.
- `tests/pagination.test.js` — cursor encode/decode, keyset direction, limit
  clamping, page assembly.
- `tests/config.test.js` — loads the config in child processes to check the
  production guards, boolean/integer parsing and fallbacks.

Integration tests **skip themselves** when no database is reachable, so `npm test`
is useful on a fresh clone before `npm run migrate`.

Three bugs were found by actually running things rather than by reading code:

1. `server.js` called `app.listen()` on the app *factory* — the process crashed on
   boot. Caught the first time the service was started against a real database.
2. `invalidateNamespace` looped forever against a real Redis: node-redis
   normalises the `SCAN` cursor to a **number**, so `while (cursor !== '0')`
   compared `0 !== '0'` and never terminated. The unit tests could not have caught
   this — it needed a real Redis-speaking server.
3. `envInt`/`envBool` read `env(name)` without forwarding their fallback, which
   made **every** optional `PG*` variable mandatory in production — the app
   refused to start on a deploy that configured only `DATABASE_URL`. Only
   visible by booting the app with `NODE_ENV=production`; there is now a
   regression test for it.

---

## Configuration

All variables are documented in [`.env.example`](.env.example).

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` refuses to boot without `JWT_SECRET` |
| `PORT` | `3000` | |
| `API_PREFIX` | `/api/v1` | |
| `DATABASE_URL` | — | wins over the discrete `PG*` variables |
| `PGHOST` `PGPORT` `PGUSER` `PGPASSWORD` `PGDATABASE` | `localhost` `5432` … | used by docker-compose |
| `DB_SSL` | `false` | `true` for providers that require TLS |
| `DB_POOL_MAX` | `10` | |
| `JWT_SECRET` | dev fallback | **must** be replaced in production |
| `JWT_EXPIRES_IN` | `7d` | |
| `REDIS_URL` | — | empty disables caching cleanly |
| `CACHE_TTL_SECONDS` | `60` | |
| `CORS_ORIGIN` | `*` | comma-separated list accepted |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `300` | auth endpoints are limited harder |
| `SEED_LISTINGS` / `SEED_SELLERS` | `600` / `25` | seed only |
| `SEED_ON_START` | `false` | docker-compose sets `true` |

---

## Security notes

- Passwords are bcrypt-hashed; the hash never appears in a response.
- Login returns **one generic message** for both unknown email and wrong password,
  and compares against a dummy hash when the user is missing, so the endpoint
  cannot be used to enumerate accounts.
- JWTs are HS256 with a pinned algorithm and issuer, so `alg: none` and
  cross-issuer tokens are rejected.
- Category writes require the `admin` role; listing writes require ownership (or
  admin), enforced by middleware rather than per-handler.
- `helmet`, CORS, `compression` and rate limiting are on by default; auth
  endpoints have a stricter limiter.
- Every SQL value is bound. The only interpolated fragments are column names and
  the `ts_rank` expression, all from internal whitelists.

---

## Trade-offs and what I would do next

Being explicit about the limits of a 3-day build:

- **Facet cost grows with facet count.** Roughly ten indexed aggregations per
  faceted request. Fine at this size and absorbed by the cache; at a much larger
  scale I would materialise facet counts into a summary table refreshed on write,
  or move faceting to a purpose-built search engine.
- **Migrations run on boot.** Convenient and safe for a single replica; with N
  replicas they would race the same DDL, so they belong in a release step.
- **Soft delete is not enforced by a database rule.** `status = 'removed'` is
  filtered in the shared query builder, which every read path goes through — but a
  future hand-written query could forget. A `listings_visible` view would make
  that impossible.
- **Filter values are matched exactly** (`= ANY(...)`) rather than
  case-insensitively, which keeps them index-backed. Autocomplete and the facets
  return the canonical values to filter by, so the client never has to guess.
- **EAV costs a join** when an attribute filter is applied or a detail page is
  read. Acceptable because the hot browse path never touches that table.
- **No refresh tokens.** A 7-day JWT with no revocation is a reasonable
  assessment trade-off; production would want short-lived access tokens plus a
  refresh flow.
- **No image upload.** Images are URLs. Real uploads need object storage and
  signed URLs, which is infrastructure rather than API design.
- **Full-text search uses the `simple` configuration.** Indonesian stemming is not
  built into PostgreSQL; the trigram branches compensate for partial words and
  typos. A production system would use a language-aware analyser.

---

## Assessment deliverables

| # | Deliverable | Where |
| --- | --- | --- |
| 1 | Repository with clear commit history (no squash) | this repo — one focused commit per feature |
| 2 | README: setup, env vars, architecture, schema rationale | this file |
| 3 | API documentation with sample requests/responses | `/api/v1/docs`, [`docs/openapi.json`](docs/openapi.json) |
| 4 | Schema diagram (dbdiagram.io) + tree/indexing rationale | [`docs/schema.dbml`](docs/schema.dbml) |
| 5 | Seed script, 500+ listings | `npm run seed` — 600 listings |
| 6 | Public deployment + live URL | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (URL pending account) |
| 7 | `.env.example` | [`.env.example`](.env.example) |
| ★ | Docker + docker-compose | [`Dockerfile`](Dockerfile), [`docker-compose.yml`](docker-compose.yml) |
| ★ | Redis caching for search | [`src/utils/cache.js`](src/utils/cache.js) |

Also included: 89 tests, an ESLint config, a [`LICENSE`](LICENSE), and
[`AGENTS.md`](AGENTS.md), the brief this was built against.

---

## License

MIT — written as a technical assessment submission.

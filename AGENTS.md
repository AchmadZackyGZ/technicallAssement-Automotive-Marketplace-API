# AGENTS.md - Automotive Marketplace API Assessment

## PT Daya Rekadigital Indonesia - Backend Developer Technical Assessment

---

## 🎯 PROJECT OVERVIEW

Build a production-grade RESTful API for an automotive marketplace platform where sellers list vehicles and buyers browse, filter, and search listings.

**Duration:** 3 Days (Take-Home Assessment)  
**Deadline:** Friday, 25 September 2026, 12:00 WIB  
**Focus Areas:** Schema design, category/filter architecture, search performance, code quality

---

## ️ TECH STACK (STRICT - DO NOT DEVIATE)

| Component        | Choice                  | Notes                                      |
| ---------------- | ----------------------- | ------------------------------------------ |
| Runtime          | Node.js 20+ LTS         |                                            |
| Framework        | Express.js              | Simple, fast, no over-engineering          |
| Database         | PostgreSQL 15+          | Relational only                            |
| ORM              | FORBIDDEN               | Use raw SQL with `pg` (node-postgres) only |
| Validation       | Zod                     | For request validation                     |
| Auth             | JWT (HS256)             | For protected endpoints                    |
| Caching          | Redis                   | **BONUS POINTS** - For search results      |
| Containerization | Docker + docker-compose | **BONUS POINTS**                           |
| Deployment       | Railway                 | Must be publicly accessible                |
| Schema Diagram   | dbdiagram.io            | ERD required in deliverables               |

---

## ARCHITECTURE DECISIONS

### Clean Architecture / Modular Monolith

**Layering.** `routes → controller → service → repository`. Each layer has one
reason to change:

| Layer | Owns | Must never |
| ----- | ---- | ---------- |
| `*.routes.js` | the HTTP contract, Swagger annotations, middleware order | contain business rules |
| `*.controller.js` | translating HTTP in/out | touch SQL |
| `*.service.js` | the rules — validation against the filter registry, ownership, cache invalidation | build SQL strings |
| `*.repository.js` | SQL, and only SQL | contain business rules |

**Why a modular monolith and not microservices.** This is a 3-day take-home with
one deployable and one database. Splitting it would add network hops, distributed
transactions and deployment surface for no benefit. The module boundaries are
drawn so that extracting a service later would be a move, not a rewrite.

**Why no ORM.** The brief forbids it, and it is the right call here: the two
hardest queries in this project — the materialized-path subtree scan and the
disjunctive facet aggregations — are exactly the kind an ORM obscures. Every
statement lives in a `*.repository.js` and is reviewable and `EXPLAIN`-able.

**Why the filter logic is data, not code.** The requirement "fuel type appears
under Cars but not Motorcycles" is expressed as rows in `filter_definitions`, not
as `if (category === 'cars')`. Adding a filter is an `INSERT`. This is the single
decision that most affects how the codebase ages.

### Domain model

Four concepts, in the assessment's own terms:

- **Vehicle Listing** — the core entity. `make`, `model`, `year`, `mileage`, `price`,
  `condition`, `transmission`, `fuel type`, `color`, images, location, and
  `status` (`available` / `sold` / `pending`, plus `removed` for soft deletion).
- **Category** — hierarchical tree with **arbitrary depth** and efficient traversal.
- **Filter Attributes** — dynamic and category-specific, typed `enum` / `range` /
  `boolean`.
- **Search Index** — full-text plus faceted search, supporting multi-filter
  combinations (make + price range + year + fuel type) with fast, consistent
  response times.

### Where each decision is documented

The README carries the full reasoning. Pointers, so this file stays a map rather
than a duplicate:

| Decision | README section | Implementation |
| -------- | -------------- | -------------- |
| Adjacency list + materialized path | *Category tree* | `src/db/migrations/003_categories.up.sql` |
| Dynamic filter registry + EAV | *Dynamic, category-specific filters* | `006_filter_definitions.up.sql`, `007_listing_attributes.up.sql` |
| tsvector + pg_trgm search | *Search — two strategies* | `listings.query.js`, `search.repository.js` |
| Disjunctive facets | *Search — facets* | `filters.service.js` |
| Cursor pagination | *Pagination — cursor, not offset* | `src/utils/pagination.js` |
| Indexing strategy | *Indexing strategy* | `004_listings.up.sql`, `009_search_indexes.up.sql` |
| Redis caching policy | *Caching* | `src/utils/cache.js` |

---

## REQUIRED API ENDPOINTS

Every endpoint below is implemented and documented in Swagger
(`/api/v1/docs`). Do not add a route without an `@openapi` block next to it.

### Listings

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `POST` | `/listings` | Create a new vehicle listing |
| `GET` | `/listings` | Browse listings with filters, sorting + cursor pagination |
| `GET` | `/listings/:id` | Get single listing detail |
| `PATCH` | `/listings/:id` | Update listing |
| `DELETE` | `/listings/:id` | Soft-delete listing (status → `removed`) |

### Search & Filters

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/listings/search` | Full-text + faceted search with combined filters |
| `GET` | `/listings/search/suggest` | Autocomplete suggestions (make, model, city) |
| `GET` | `/filters` | All available filter options with counts (facets) |
| `GET` | `/filters/:categoryId` | Filter attributes specific to a category |

### Categories

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/categories` | Get full category tree |
| `GET` | `/categories/:id` | Get single category with its children |
| `GET` | `/categories/:id/listings` | Browse listings scoped to a category + subcategories |
| `POST` | `/categories` | Create category node |
| `PATCH` | `/categories/:id` | Update category |

### Supporting (added, not required)

| Method | Endpoint | Why it exists |
| ------ | -------- | ------------- |
| `POST` | `/auth/register`, `/auth/login` | listings need an owner, and `POST /listings` needs a seller |
| `GET` `PATCH` | `/auth/me` | profile |
| `GET` | `/health` | required by Railway's healthcheck; returns 503 without a database |

**Route ordering.** `/listings/search` and `/listings/search/suggest` are mounted
inside `listings.routes.js` **before** `/:id`. Express matches in registration
order, so a literal segment registered later would be captured as an id. That
ordering is enforced in the router itself so it cannot be broken from
`routes/index.js`.

---

## DELIVERABLES

| # | Deliverable | Where it lives |
| - | ----------- | -------------- |
| 1 | Repository with a clear commit history — **do not squash** | this repo, one focused commit per feature |
| 2 | README: setup, env vars, how to run, architecture and schema rationale | `README.md` |
| 3 | API documentation with sample requests and responses | `docs/openapi.json` + Swagger UI at `/api/v1/docs` |
| 4 | Schema diagram from dbdiagram.io, explaining tree strategy and indexing | `docs/schema.dbml` (paste into dbdiagram.io) |
| 5 | Seed script — at least 500 listings across multiple categories | `npm run seed` → 600 listings |
| 6 | Public deployment, live base URL in the README | `docs/DEPLOYMENT.md`, `railway.json` |
| 7 | `.env.example` | `.env.example` |
| ★ | Redis caching for search endpoints | `src/utils/cache.js` |
| ★ | Docker + docker-compose | `Dockerfile`, `docker-compose.yml` |

---

## SEED DATA REQUIREMENTS

`npm run seed` generates **600 listings** (minimum required: 500) across the full
category tree, plus ~2 700 gallery images and ~2 000 dynamic attribute values, in
about 8 seconds.

Categories seeded:

```
Vehicles
├── Cars                  (Sedan, SUV, MPV, Hatchback, Pickup)
├── Motorcycles           (Sport, Matic, Bebek)
└── Commercial Vehicles   (Truck, Bus)
```

Realistic Indonesian market data:

- **Makes:** Toyota, Honda, Mitsubishi, Suzuki, Daihatsu, Nissan, BMW,
  Mercedes-Benz, Hyundai, Wuling — plus Yamaha, Kawasaki (motorcycles) and Hino,
  Isuzu (commercial), because those categories need makes too.
- **Models per make:** 3–5 (60 car models, 19 motorcycles, 8 commercial).
- **Years:** 2015–2024.
- **Prices:** Rp 6.2 jt – Rp 1.99 bn. Cars span the brief's Rp 50 jt – Rp 2 bn
  band; motorcycles sit lower because that is what they actually cost.
- **Cities:** Jakarta, Surabaya, Bandung, Semarang, Yogyakarta, Medan, Makassar,
  Denpasar (+ Tangerang, Bekasi), each with its province.
- **Fuel types:** gasoline, diesel, electric, hybrid.
- **Transmissions:** manual, automatic, cvt.

Two properties that matter more than the ranges:

- **Prices are depreciated by age** from each model's own band (38% floor), so a
  2015 Avanza is never priced like a 2024 one. Uniform sampling over the whole
  range would make every price filter meaningless.
- **Generation is deterministic** (`SEED_RANDOM_SEED`, default 42), so two people
  running the seed get identical data and the numbers in the README are
  verifiable.

The seed is destructive by design — it truncates marketplace tables and
regenerates them. It is a setup step, not something to run against live data.

---

## COMMIT HISTORY REQUIREMENTS

**Make meaningful commits. Do not squash.** One commit per logical change, with a
message body that explains *why* the change was made — not just what changed.

The expected shape of the history, and what was actually done:

```
feat: initial project setup with Express + PostgreSQL
feat: database schema and migrations
feat: user authentication (register/login)
feat: category CRUD with hierarchical tree
feat: listing CRUD with validation
feat: cursor pagination for listings
feat: full-text search implementation
feat: faceted filters and filter counts
feat: autocomplete suggestions
feat: seed script with 500+ listings
feat: Swagger API documentation
feat: Redis caching for search endpoints
feat: Docker & docker-compose
feat: deployment to Railway
docs: comprehensive README
```

Plus four commits that were not planned and should not be squashed away, because
they are the evidence that the service was actually run:

```
fix: correct server bootstrap and expose /health at the root
fix: defer to the handler when an owned resource is missing
fix: production config made every optional PG* variable mandatory
chore: commit the npm lockfile for reproducible installs
```

---

## REPO CONVENTIONS

Follow these when adding code. They exist so the codebase stays uniform.

**SQL**

- Aliasing: every column is aliased to **camelCase** in `SELECT` / `RETURNING`, so
  responses are camelCase with no mapping layer. Cursor `cursorField` values must
  match those aliases (`createdAt`, not `created_at`) — getting this wrong silently
  produces `null` cursors.
- `NUMERIC` comes back from `pg` as a **string**. Map it to a number in the
  repository (see `mapListing`).
- Multi-table writes go through `db.withTransaction`. A listing must never end up
  half-created.
- All values are bound. The only interpolated fragments are column names and the
  `ts_rank` expression, both from internal whitelists.
- New migrations are numbered pairs: `NNN_name.up.sql` / `NNN_name.down.sql`.
  Both directions must work — `npm run migrate:reset` is exercised.

**Validation**

- Zod schemas live in `*.schema.js` and are applied by the `validate()` middleware.
  Controllers receive coerced input and never read a raw string off `req.query`.
- `req.query` must be redefined with `Object.defineProperty`, not assigned: Express
  installs it as a getter-only accessor and a plain assignment throws in strict
  mode.

**Errors**

- Throw typed `AppError` subclasses (`NotFoundError`, `ValidationError`, …). The
  central handler in `src/middleware/errorHandler.js` is the only place that writes
  an error response. Never `res.status(500)` inside a handler.
- Never leak internals in a production 500 — the handler already hides the message
  and stack when `NODE_ENV=production`.

**Caching**

- Only cache endpoints whose cost scales with the catalogue, not the response.
  `GET /listings` is deliberately uncached; search, filters and suggest are.
- Any listing or category write must call `cache.invalidateCatalog()`. The
  invalidation is coarse on purpose — a stale facet count is the one thing a
  faceted search must never serve.

**Comments**

- Comment the *why*, never the *what*. If a line needs a comment to explain what it
  does, rename something instead. The existing code follows this: comments explain
  rejected alternatives, invariants, and traps.

---

## COMMANDS

```bash
npm run dev            # nodemon
npm start              # plain node
npm run migrate        # apply pending migrations
npm run migrate:down   # revert the most recent
npm run migrate:status # applied vs pending
npm run migrate:reset  # revert everything
npm run seed           # reset + regenerate demo data
npm test               # 89 tests; integration tests skip without a database
npm run lint           # eslint
npm run docs:export    # regenerate docs/openapi.json
```

Local stack without installing PostgreSQL or Redis:

```bash
docker compose up --build
```

Demo credentials created by the seed:

| Role | Email | Password |
| ---- | ----- | -------- |
| Admin | `admin@automotive.test` | `Admin12345` |
| Seller | `seller1@automotive.test` | `Seller12345` |
| Buyer | `buyer@automotive.test` | `Buyer12345` |

---

## NOTES ON THIS FILE

The version of this file originally committed to the repository was truncated —
it ended mid-sentence at `### Clean Architecture / Modular Monolith`. Everything
from that heading onwards has been completed from the assessment PDF
(*Backend Technical Assessment - PT Daya Rekadigital Indonesia*, 4 pages) plus the
planning notes supplied alongside it. The content above the heading is the
original, unmodified.

`README.md` remains the authoritative explanation of the architectural decisions;
this file is the working brief for anyone (human or agent) continuing the project.

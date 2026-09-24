'use strict';

/**
 * OpenAPI 3.0 specification.
 *
 * The paths are collected from `@openapi` JSDoc blocks next to the routes they
 * describe (swagger-jsdoc), so documentation lives with the code it documents and
 * cannot drift into a separate file. This module owns everything that is shared:
 * schemas, reusable responses, parameters and the security scheme.
 */

const path = require('path');
const config = require('./index');

/** Glob patterns must use forward slashes, including on Windows. */
const toGlob = (relative) => path.join(__dirname, '..', relative).replace(/\\/g, '/');

const definition = {
  openapi: '3.0.3',

  info: {
    title: 'Automotive Marketplace API',
    version: require('../../package.json').version,
    description: `
REST API for an automotive marketplace: sellers list vehicles, buyers browse,
filter and search them.

Built with Node.js, Express and PostgreSQL using raw SQL (no ORM), validated with
Zod and authenticated with JWT (HS256).

## Things worth knowing before you use it

**Pagination is cursor-based, not offset-based.** Every list endpoint returns a
\`nextCursor\`. Pass it back as \`cursor\` and repeat until it is \`null\`. Offset
paging would force PostgreSQL to generate and discard every skipped row, and
would shift results whenever a listing was inserted mid-pagination. See the
\`/listings\` description for the full rationale.

**Filters are data, not code.** A listing's category decides which filters apply
to it. \`GET /filters/{categoryId}\` returns that set; the same keys are accepted
by \`POST /listings\` under \`attributes\` and by the browse and search endpoints
as \`attr[key]\` query parameters. Adding a filter is an INSERT into
\`filter_definitions\`, not a code change.

**Deletion is soft.** \`DELETE /listings/{id}\` sets \`status\` to \`removed\` and
stamps \`deleted_at\`. The row is retained for referential integrity and audit,
and disappears from every browse and search result.

## Trying it out

1. \`POST /auth/login\` with the seeded seller account below.
2. Copy \`data.token\`, click **Authorize**, and paste it.
3. \`POST /listings\` to create something, then \`GET /listings\` to browse.

Seeded credentials (from \`npm run seed\`):
| Role | Email | Password |
| ---- | ----- | -------- |
| Admin | admin@automotive.test | Admin12345 |
| Seller | seller1@automotive.test | Seller12345 |
| Buyer | buyer@automotive.test | Buyer12345 |
`.trim(),

    contact: {
      name: 'Backend Technical Assessment submission',
      url: 'https://github.com/',
    },
    license: { name: 'MIT' },
  },

  servers: [
    { url: '/api/v1', description: 'Current server (versioned API prefix)' },
    { url: 'http://localhost:3000/api/v1', description: 'Local development' },
  ],

  tags: [
    { name: 'Auth', description: 'Registration, login and the current user.' },
    { name: 'Categories', description: 'Hierarchical category tree and category-scoped browsing.' },
    { name: 'Listings', description: 'Vehicle listing CRUD, browsing and soft deletion.' },
    { name: 'Search', description: 'Full-text search, facets and autocomplete.' },
    { name: 'Filters', description: 'Dynamic, category-specific filter options with counts.' },
    { name: 'System', description: 'Health and service metadata.' },
  ],

  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'HS256 JWT issued by `POST /auth/login`. Send as `Authorization: Bearer <token>`.',
      },
    },

    parameters: {
      ListingId: {
        in: 'path',
        name: 'id',
        required: true,
        schema: { type: 'string', format: 'uuid' },
        description: 'Listing id',
      },
      CategoryId: {
        in: 'path',
        name: 'id',
        required: true,
        schema: { type: 'string', format: 'uuid' },
        description: 'Category id',
      },
      SortParam: {
        in: 'query',
        name: 'sort',
        schema: {
          type: 'string',
          default: 'newest',
          enum: [
            'newest',
            'oldest',
            'price_asc',
            'price_desc',
            'year_desc',
            'year_asc',
            'mileage_asc',
            'mileage_desc',
            'relevance',
          ],
        },
        description:
          'Sort order. `relevance` requires `q` and ranks by ts_rank; without a query it falls back to `newest`.',
      },
      LimitParam: {
        in: 'query',
        name: 'limit',
        schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        description: 'Page size',
      },
      CursorParam: {
        in: 'query',
        name: 'cursor',
        schema: { type: 'string' },
        description:
          'Opaque cursor from the previous response. A cursor issued for a different `sort` is rejected with 400.',
      },
    },

    schemas: {
      // --- Auth ------------------------------------------------------------
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email', example: 'seller1@automotive.test' },
          name: { type: 'string', example: 'Budi Santoso' },
          phone: { type: 'string', nullable: true, example: '+6281234567890' },
          role: { type: 'string', enum: ['buyer', 'seller', 'admin'] },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },

      AuthResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              token: { type: 'string' },
              tokenType: { type: 'string', example: 'Bearer' },
              expiresIn: { type: 'string', example: '7d' },
            },
          },
        },
      },

      // --- Categories ------------------------------------------------------
      Category: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'SUV' },
          slug: { type: 'string', example: 'suv' },
          parentId: { type: 'string', format: 'uuid', nullable: true },
          path: {
            type: 'string',
            description: 'Materialized path of ancestor ids, self included',
            example: '/a1b2.../c3d4.../e5f6.../',
          },
          depth: { type: 'integer', example: 2 },
          description: { type: 'string', nullable: true },
          icon: { type: 'string', nullable: true },
          sortOrder: { type: 'integer' },
          isActive: { type: 'boolean' },
          listingCount: { type: 'integer', description: 'Listings directly attached' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },

      CategoryDetail: {
        allOf: [
          { $ref: '#/components/schemas/Category' },
          {
            type: 'object',
            properties: {
              children: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
              effectiveFilters: {
                type: 'array',
                description: 'Filter definitions this category exposes, own plus inherited',
                items: { $ref: '#/components/schemas/FilterDefinition' },
              },
            },
          },
        ],
      },

      // --- Listings --------------------------------------------------------
      ListingImage: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          url: { type: 'string', format: 'uri' },
          altText: { type: 'string', nullable: true },
          position: { type: 'integer' },
          isPrimary: { type: 'boolean' },
        },
      },

      ListingAttribute: {
        type: 'object',
        description: 'A category-specific attribute, resolved through the filter registry',
        properties: {
          key: { type: 'string', example: 'engine_cc' },
          label: { type: 'string', example: 'Engine Displacement' },
          type: { type: 'string', enum: ['enum', 'range', 'boolean'] },
          unit: { type: 'string', nullable: true, example: 'cc' },
          source: { type: 'string', enum: ['column', 'attribute'] },
          value: { description: 'String, number or boolean depending on `type`', example: 1500 },
        },
      },

      Listing: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          sellerId: { type: 'string', format: 'uuid' },
          categoryId: { type: 'string', format: 'uuid' },
          title: { type: 'string', example: '2019 Toyota Avanza G AT' },
          description: { type: 'string', nullable: true },
          make: { type: 'string', example: 'Toyota' },
          model: { type: 'string', example: 'Avanza' },
          year: { type: 'integer', example: 2019 },
          mileageKm: { type: 'integer', example: 62000 },
          condition: { type: 'string', enum: ['new', 'used', 'certified'] },
          transmission: { type: 'string', nullable: true, enum: ['manual', 'automatic', 'cvt'] },
          fuelType: { type: 'string', nullable: true, enum: ['gasoline', 'diesel', 'electric', 'hybrid'] },
          color: { type: 'string', nullable: true, example: 'Silver' },
          price: { type: 'number', example: 185000000, description: 'Amount in `currency`' },
          currency: { type: 'string', example: 'IDR' },
          status: { type: 'string', enum: ['available', 'sold', 'pending', 'removed'] },
          isFeatured: { type: 'boolean' },
          locationCity: { type: 'string', nullable: true, example: 'Jakarta' },
          locationProvince: { type: 'string', nullable: true, example: 'DKI Jakarta' },
          viewCount: { type: 'integer' },
          primaryImageUrl: { type: 'string', format: 'uri', nullable: true },
          publishedAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          deletedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },

      ListingDetail: {
        allOf: [
          { $ref: '#/components/schemas/Listing' },
          {
            type: 'object',
            properties: {
              category: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  path: { type: 'string' },
                  depth: { type: 'integer' },
                },
              },
              seller: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  phone: { type: 'string', nullable: true },
                  role: { type: 'string' },
                },
              },
              images: { type: 'array', items: { $ref: '#/components/schemas/ListingImage' } },
              attributes: { type: 'array', items: { $ref: '#/components/schemas/ListingAttribute' } },
            },
          },
        ],
      },

      // --- Search & filters -------------------------------------------------
      Pagination: {
        type: 'object',
        properties: {
          limit: { type: 'integer', example: 20 },
          count: { type: 'integer', example: 20 },
          hasMore: { type: 'boolean', example: true },
          sort: { type: 'string', example: 'newest' },
          nextCursor: {
            type: 'string',
            nullable: true,
            description: 'Pass as `cursor` to fetch the next page. `null` on the last page.',
          },
        },
      },

      FilterDefinition: {
        type: 'object',
        description:
          'A filter declared for a category. Inherited by descendants, so "Cars > SUV" exposes everything declared on "Cars".',
        properties: {
          id: { type: 'string', format: 'uuid' },
          categoryId: { type: 'string', format: 'uuid' },
          key: { type: 'string', example: 'engine_cc' },
          label: { type: 'string', example: 'Engine Displacement' },
          type: { type: 'string', enum: ['enum', 'range', 'boolean'] },
          source: {
            type: 'string',
            enum: ['column', 'attribute'],
            description: '`column` reads a first-class listings column; `attribute` reads the EAV table.',
          },
          columnName: { type: 'string', nullable: true, example: 'fuel_type' },
          unit: { type: 'string', nullable: true, example: 'cc' },
          options: {
            type: 'array',
            nullable: true,
            items: {
              type: 'object',
              properties: {
                value: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
          minValue: { type: 'number', nullable: true },
          maxValue: { type: 'number', nullable: true },
          isFilterable: { type: 'boolean' },
          isFacetable: { type: 'boolean' },
          sortOrder: { type: 'integer' },
        },
      },

      FacetValue: {
        type: 'object',
        properties: {
          value: { description: 'The filter value to send back' },
          label: { type: 'string' },
          count: { type: 'integer', example: 148 },
          id: { type: 'string', format: 'uuid', description: 'Present for the category facet' },
          name: { type: 'string', description: 'Present for the category facet' },
          slug: { type: 'string', description: 'Present for the category facet' },
        },
      },

      FacetGroup: {
        type: 'object',
        properties: {
          key: { type: 'string', example: 'make' },
          label: { type: 'string', example: 'Make' },
          type: { type: 'string', enum: ['enum', 'range', 'boolean'] },
          source: { type: 'string', enum: ['column', 'attribute'] },
          unit: { type: 'string', nullable: true },
          min: { type: 'number', nullable: true, description: 'Range facets only' },
          max: { type: 'number', nullable: true, description: 'Range facets only' },
          count: { type: 'integer', description: 'Range facets only' },
          values: { type: 'array', items: { $ref: '#/components/schemas/FacetValue' } },
        },
      },

      RangeFacet: {
        type: 'object',
        properties: {
          key: { type: 'string', example: 'price' },
          label: { type: 'string', example: 'Price' },
          type: { type: 'string', example: 'range' },
          unit: { type: 'string', nullable: true, example: 'IDR' },
          min: { type: 'number', nullable: true, example: 6200000 },
          max: { type: 'number', nullable: true, example: 1989000000 },
          total: { type: 'integer', example: 612 },
          buckets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', example: 'under_100m' },
                label: { type: 'string', example: 'Under Rp 100 jt' },
                min: { type: 'number', nullable: true },
                max: { type: 'number', nullable: true },
                count: { type: 'integer', example: 84 },
              },
            },
          },
        },
      },

      Facets: {
        type: 'object',
        description:
          'Facet counts for the whole matching set. Each group is computed with its own filter removed (disjunctive), so switching values stays possible.',
        properties: {
          totalMatching: { type: 'integer', example: 612 },
          groups: { type: 'array', items: { $ref: '#/components/schemas/FacetGroup' } },
          ranges: {
            type: 'object',
            additionalProperties: { $ref: '#/components/schemas/RangeFacet' },
          },
        },
      },

      Suggestion: {
        type: 'object',
        properties: {
          value: { type: 'string', example: 'Toyota' },
          listingCount: { type: 'integer', example: 87 },
          prefixMatch: { type: 'boolean', description: 'True when the value starts with the search term' },
        },
      },

      HealthStatus: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'], example: 'ok' },
          uptimeSeconds: { type: 'integer', example: 3612 },
          checks: {
            type: 'object',
            properties: {
              database: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean', example: true },
                  latencyMs: { type: 'integer', example: 1 },
                  error: { type: 'string', nullable: true },
                },
              },
              cache: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean', example: true },
                  enabled: { type: 'boolean', example: true },
                  error: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
      },

      // --- Errors -----------------------------------------------------------
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'NOT_FOUND' },
              message: { type: 'string', example: 'Listing not found' },
              details: {
                description: 'Present for validation failures: one entry per offending field',
                nullable: true,
              },
              requestId: { type: 'string' },
            },
          },
        },
      },
    },

    responses: {
      BadRequest: {
        description: 'Malformed request - for example a cursor issued for a different sort order',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Unauthorized: {
        description: 'Missing, malformed or expired bearer token',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Authenticated, but not allowed to perform this action',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'The resource does not exist (or was soft-deleted)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Conflict: {
        description: 'The resource already exists, or a foreign key would be violated',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      ValidationError: {
        description: 'Request body or query failed validation. `error.details` lists each field.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'One or more filter attributes are invalid',
                details: [
                  {
                    field: 'attributes.engine_cc',
                    message: 'Must be between 50 and 10000 cc',
                    code: 'out_of_range',
                  },
                ],
              },
            },
          },
        },
      },
      TooManyRequests: {
        description: 'Rate limit exceeded',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
};

/** The assembled specification, ready to hand to swagger-ui-express. */
const swaggerSpec = require('swagger-jsdoc')({
  definition,
  apis: [toGlob('modules/**/*.routes.js'), toGlob('routes/*.js')],
});

module.exports = { swaggerSpec, definition };

-- ===========================================================================
-- 006 - Filter definitions (the dynamic, category-scoped filter registry)
-- ===========================================================================
-- This table is the answer to "dynamic, category-specific filter attributes".
--
-- A row declares: "for this category, expose a filter called `engine_cc`, of
-- type `range`, whose value comes from column `engine_cc`". The API reads this
-- registry to build its query planner AND its facet aggregations, so adding a
-- new filter is an INSERT, not a code change.
--
-- Two value sources are supported, which is what keeps the design honest:
--
--   source = 'column'    -> the value is a first-class column on `listings`
--                           (make, price, year, fuel_type, transmission ...).
--                           Fast: no join, plain btree index, usable in facets.
--
--   source = 'attribute' -> the value lives in `listing_attributes` (EAV), for
--                           genuinely sparse, category-specific data such as
--                           `battery_capacity_kwh` or `seat_count`.
--
-- Attributes are declared on the category they belong to. A category inherits
-- the definitions of all its ancestors, which is how "Cars > SUV" automatically
-- gets every filter declared on "Cars" without duplicating rows.
-- ===========================================================================

CREATE TABLE filter_definitions (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID          NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  key           VARCHAR(60)   NOT NULL,
  label         VARCHAR(100)  NOT NULL,
  type          VARCHAR(20)   NOT NULL,
  source        VARCHAR(20)   NOT NULL DEFAULT 'column',
  column_name   VARCHAR(60),
  unit          VARCHAR(20),
  options       JSONB,
  min_value     NUMERIC(14,2),
  max_value     NUMERIC(14,2),
  is_filterable BOOLEAN       NOT NULL DEFAULT TRUE,
  is_facetable  BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order    INTEGER       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT filter_definitions_type_check   CHECK (type IN ('enum', 'range', 'boolean')),
  CONSTRAINT filter_definitions_source_check CHECK (source IN ('column', 'attribute')),
  CONSTRAINT filter_definitions_key_check    CHECK (key ~ '^[a-z][a-z0-9_]*$'),

  -- A column-backed filter without a column name is meaningless.
  CONSTRAINT filter_definitions_column_check CHECK (
    (source = 'column'    AND column_name IS NOT NULL)
    OR
    (source = 'attribute' AND column_name IS NULL)
  ),

  -- An enum filter must ship its allowed values.
  CONSTRAINT filter_definitions_enum_check CHECK (
    type <> 'enum' OR (options IS NOT NULL AND jsonb_typeof(options) = 'array')
  ),

  -- A range filter must ship its bounds so the UI can render a slider.
  CONSTRAINT filter_definitions_range_check CHECK (
    type <> 'range' OR (min_value IS NOT NULL AND max_value IS NOT NULL AND min_value < max_value)
  )
);

-- One definition per key per category.
CREATE UNIQUE INDEX filter_definitions_category_key_unique_idx
  ON filter_definitions (category_id, key);

CREATE INDEX filter_definitions_category_idx ON filter_definitions (category_id, sort_order);
CREATE INDEX filter_definitions_options_idx  ON filter_definitions USING GIN (options);

CREATE TRIGGER filter_definitions_set_updated_at
BEFORE UPDATE ON filter_definitions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Convenience view: the effective filter set for every category, including the
-- definitions inherited from its ancestors.
--
-- Joining on the materialized path means "inherited" is a prefix match rather
-- than a recursive walk - the same trick used for subtree listing queries.
-- ---------------------------------------------------------------------------
CREATE VIEW category_effective_filters AS
SELECT
  c.id                  AS category_id,
  c.slug                AS category_slug,
  fd.id                 AS definition_id,
  fd.key,
  fd.label,
  fd.type,
  fd.source,
  fd.column_name,
  fd.unit,
  fd.options,
  fd.min_value,
  fd.max_value,
  fd.is_filterable,
  fd.is_facetable,
  fd.sort_order,
  (fd.category_id = c.id) AS is_own_definition
FROM categories c
JOIN categories owner
  ON c.path LIKE owner.path || '%'
JOIN filter_definitions fd
  ON fd.category_id = owner.id;

COMMENT ON TABLE  filter_definitions IS 'Category-scoped filter registry driving dynamic filters and facets.';
COMMENT ON COLUMN filter_definitions.source IS 'column = first-class listings column; attribute = EAV row in listing_attributes.';
COMMENT ON VIEW   category_effective_filters IS 'Filter definitions a category exposes, own + inherited from ancestors.';

-- ===========================================================================
-- 004 - Listings (the core entity)
-- ===========================================================================
-- DESIGN NOTE - what is a column and what is not.
--
-- `listings` holds only the attributes *every* vehicle shares, i.e. exactly the
-- set the brief calls out: make, model, year, mileage, price, condition,
-- transmission, fuel type, color, location and status. Anything that is true
-- for one category but meaningless for another (engine displacement, seat
-- count, battery capacity, drive type ...) lives in `listing_attributes` and is
-- declared per category in `filter_definitions`.
--
-- That split is what makes "fuel type only appears under Cars, not Motorcycles"
-- expressible without schema changes: the *filter registry* decides which
-- filters a category exposes, while the storage stays uniform.
--
-- Full-text search uses a GENERATED column rather than a trigger. Because
-- `to_tsvector(regconfig, text)` is IMMUTABLE, PostgreSQL can maintain it
-- itself: it can never drift out of sync with the row, and there is no trigger
-- to forget when adding a new searchable field.
-- ===========================================================================

CREATE TABLE listings (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         UUID          NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id       UUID          NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,

  -- --- Content ------------------------------------------------------------
  title             VARCHAR(200)  NOT NULL,
  description       TEXT,

  -- --- Vehicle identity ---------------------------------------------------
  make              VARCHAR(80)   NOT NULL,
  model             VARCHAR(80)   NOT NULL,
  year              SMALLINT      NOT NULL,
  mileage_km        INTEGER       NOT NULL DEFAULT 0,
  condition         VARCHAR(20)   NOT NULL DEFAULT 'used',
  transmission      VARCHAR(20),
  fuel_type         VARCHAR(20),
  color             VARCHAR(40),

  -- --- Commercial ---------------------------------------------------------
  price             NUMERIC(14,2) NOT NULL,
  currency          CHAR(3)       NOT NULL DEFAULT 'IDR',
  status            VARCHAR(20)   NOT NULL DEFAULT 'available',
  is_featured       BOOLEAN       NOT NULL DEFAULT FALSE,

  -- --- Location -----------------------------------------------------------
  location_city     VARCHAR(80),
  location_province VARCHAR(80),

  -- --- Bookkeeping --------------------------------------------------------
  view_count        INTEGER       NOT NULL DEFAULT 0,
  published_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,

  -- --- Search -------------------------------------------------------------
  -- Weighted so a match in the title outranks a match in the description.
  search_vector     TSVECTOR GENERATED ALWAYS AS (
                      setweight(to_tsvector('simple', COALESCE(title, '')), 'A')
                   || setweight(to_tsvector('simple', COALESCE(make, '') || ' ' || COALESCE(model, '')), 'A')
                   || setweight(to_tsvector('simple', COALESCE(color, '')), 'B')
                   || setweight(to_tsvector('simple', COALESCE(location_city, '') || ' ' || COALESCE(location_province, '')), 'B')
                   || setweight(to_tsvector('simple', COALESCE(description, '')), 'C')
                    ) STORED,

  -- --- Guard rails --------------------------------------------------------
  CONSTRAINT listings_title_check        CHECK (length(trim(title)) > 0),
  CONSTRAINT listings_make_check         CHECK (length(trim(make)) > 0),
  CONSTRAINT listings_model_check        CHECK (length(trim(model)) > 0),
  CONSTRAINT listings_year_check         CHECK (year BETWEEN 1900 AND 2100),
  CONSTRAINT listings_mileage_check      CHECK (mileage_km >= 0),
  CONSTRAINT listings_price_check        CHECK (price >= 0),
  CONSTRAINT listings_view_count_check   CHECK (view_count >= 0),
  CONSTRAINT listings_currency_check     CHECK (currency = 'IDR'),
  CONSTRAINT listings_status_check       CHECK (status IN ('available', 'sold', 'pending', 'removed')),
  CONSTRAINT listings_condition_check    CHECK (condition IN ('new', 'used', 'certified')),
  CONSTRAINT listings_transmission_check CHECK (transmission IS NULL OR transmission IN ('manual', 'automatic', 'cvt')),
  CONSTRAINT listings_fuel_type_check    CHECK (fuel_type IS NULL OR fuel_type IN ('gasoline', 'diesel', 'electric', 'hybrid'))
);

-- ---------------------------------------------------------------------------
-- Indexing strategy (explained in full in the README).
--
-- 1. Keyset pagination. Every browse/search query sorts by (created_at, id) or
--    (price, id) with a leading status predicate, so the index must lead with
--    the equality column and then carry the sort columns in matching order.
-- ---------------------------------------------------------------------------
CREATE INDEX listings_status_created_idx
  ON listings (status, created_at DESC, id DESC);

CREATE INDEX listings_status_price_idx
  ON listings (status, price ASC, id ASC);

-- Category-scoped browsing is the single hottest access path.
CREATE INDEX listings_category_status_created_idx
  ON listings (category_id, status, created_at DESC, id DESC);

-- 2. Facet/filter columns. Low cardinality columns are still worth indexing
--    because the facet aggregations always combine them with a status filter.
CREATE INDEX listings_make_idx         ON listings (make);
CREATE INDEX listings_model_idx        ON listings (model);
CREATE INDEX listings_year_idx         ON listings (year);
CREATE INDEX listings_price_idx        ON listings (price);
CREATE INDEX listings_mileage_idx      ON listings (mileage_km);
CREATE INDEX listings_fuel_type_idx    ON listings (fuel_type);
CREATE INDEX listings_transmission_idx ON listings (transmission);
CREATE INDEX listings_condition_idx    ON listings (condition);
CREATE INDEX listings_city_idx         ON listings (location_city);

-- 3. Seller dashboard: "my listings", newest first.
CREATE INDEX listings_seller_created_idx ON listings (seller_id, created_at DESC);

-- 4. Full-text search - GIN is the only index type that can accelerate @@.
CREATE INDEX listings_search_vector_idx ON listings USING GIN (search_vector);

-- 5. Autocomplete / typo tolerance. Trigram GIN indexes let `ILIKE '%toyo%'`
--    and `similarity()` run without a sequential scan.
CREATE INDEX listings_make_trgm_idx ON listings USING GIN (make gin_trgm_ops);
CREATE INDEX listings_model_trgm_idx ON listings USING GIN (model gin_trgm_ops);
CREATE INDEX listings_city_trgm_idx  ON listings USING GIN (location_city gin_trgm_ops);

CREATE TRIGGER listings_set_updated_at
BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  listings            IS 'Vehicle listings created by sellers.';
COMMENT ON COLUMN listings.status     IS 'available | sold | pending | removed. DELETE /listings/:id is a soft delete that sets "removed".';
COMMENT ON COLUMN listings.deleted_at IS 'Audit trail for soft deletes; status is the source of truth for visibility.';
COMMENT ON COLUMN listings.search_vector IS 'Generated, weighted tsvector maintained by PostgreSQL itself.';

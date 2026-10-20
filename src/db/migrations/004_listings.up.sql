CREATE TABLE listings (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         UUID          NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id       UUID          NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,

  title             VARCHAR(200)  NOT NULL,
  description       TEXT,

  make              VARCHAR(80)   NOT NULL,
  model             VARCHAR(80)   NOT NULL,
  year              SMALLINT      NOT NULL,
  mileage_km        INTEGER       NOT NULL DEFAULT 0,
  condition         VARCHAR(20)   NOT NULL DEFAULT 'used',
  transmission      VARCHAR(20),
  fuel_type         VARCHAR(20),
  color             VARCHAR(40),

  price             NUMERIC(14,2) NOT NULL,
  currency          CHAR(3)       NOT NULL DEFAULT 'IDR',
  status            VARCHAR(20)   NOT NULL DEFAULT 'available',
  is_featured       BOOLEAN       NOT NULL DEFAULT FALSE,

  location_city     VARCHAR(80),
  location_province VARCHAR(80),

  view_count        INTEGER       NOT NULL DEFAULT 0,
  published_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,

  search_vector     TSVECTOR GENERATED ALWAYS AS (
                      setweight(to_tsvector('simple', COALESCE(title, '')), 'A')
                   || setweight(to_tsvector('simple', COALESCE(make, '') || ' ' || COALESCE(model, '')), 'A')
                   || setweight(to_tsvector('simple', COALESCE(color, '')), 'B')
                   || setweight(to_tsvector('simple', COALESCE(location_city, '') || ' ' || COALESCE(location_province, '')), 'B')
                   || setweight(to_tsvector('simple', COALESCE(description, '')), 'C')
                    ) STORED,

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

CREATE INDEX listings_status_created_idx
  ON listings (status, created_at DESC, id DESC);

CREATE INDEX listings_status_price_idx
  ON listings (status, price ASC, id ASC);

CREATE INDEX listings_category_status_created_idx
  ON listings (category_id, status, created_at DESC, id DESC);

CREATE INDEX listings_make_idx         ON listings (make);
CREATE INDEX listings_model_idx        ON listings (model);
CREATE INDEX listings_year_idx         ON listings (year);
CREATE INDEX listings_price_idx        ON listings (price);
CREATE INDEX listings_mileage_idx      ON listings (mileage_km);
CREATE INDEX listings_fuel_type_idx    ON listings (fuel_type);
CREATE INDEX listings_transmission_idx ON listings (transmission);
CREATE INDEX listings_condition_idx    ON listings (condition);
CREATE INDEX listings_city_idx         ON listings (location_city);

CREATE INDEX listings_seller_created_idx ON listings (seller_id, created_at DESC);

CREATE INDEX listings_search_vector_idx ON listings USING GIN (search_vector);

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

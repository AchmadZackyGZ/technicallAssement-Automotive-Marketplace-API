-- ===========================================================================
-- 007 - Listing attributes (EAV for sparse, category-specific values)
-- ===========================================================================
-- One row per (listing, filter definition) pair.
--
-- Three typed value columns instead of a single TEXT column:
--   value_text  -> enum values and free text
--   value_num   -> range values, so BETWEEN uses a numeric btree index
--   value_bool  -> boolean flags
--
-- Storing numbers as text would force a cast on every comparison and make the
-- index useless; the CHECK constraint below enforces that exactly one of the
-- three is populated, matching the definition's declared type.
--
-- The trade-off of EAV is that reading a full attribute set costs a join. That
-- is acceptable here because attributes are only read on the detail endpoint
-- and when an attribute-backed filter is actually applied - the hot browse path
-- never touches this table.
-- ===========================================================================

CREATE TABLE listing_attributes (
  listing_id    UUID          NOT NULL REFERENCES listings(id)           ON DELETE CASCADE,
  definition_id UUID          NOT NULL REFERENCES filter_definitions(id) ON DELETE CASCADE,
  value_text    TEXT,
  value_num     NUMERIC(14,2),
  value_bool    BOOLEAN,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  PRIMARY KEY (listing_id, definition_id),

  -- Exactly one typed slot must be filled.
  CONSTRAINT listing_attributes_single_value_check CHECK (
    (value_text IS NOT NULL)::int + (value_num IS NOT NULL)::int + (value_bool IS NOT NULL)::int = 1
  )
);

-- Partial indexes: only the populated column of each type is indexed, which
-- keeps them small and lets `WHERE definition_id = $1 AND value_num BETWEEN ..`
-- run as an index range scan.
CREATE INDEX listing_attributes_text_idx
  ON listing_attributes (definition_id, value_text) WHERE value_text IS NOT NULL;

CREATE INDEX listing_attributes_num_idx
  ON listing_attributes (definition_id, value_num) WHERE value_num IS NOT NULL;

CREATE INDEX listing_attributes_bool_idx
  ON listing_attributes (definition_id, value_bool) WHERE value_bool IS NOT NULL;

-- Reverse lookup: "which listings have this attribute at all" and full-listing
-- attribute hydration on the detail endpoint.
CREATE INDEX listing_attributes_listing_idx ON listing_attributes (listing_id);

CREATE TRIGGER listing_attributes_set_updated_at
BEFORE UPDATE ON listing_attributes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  listing_attributes IS 'EAV values for category-specific filter attributes; typed per definition.';
COMMENT ON COLUMN listing_attributes.definition_id IS 'Declares the key, type and unit; values are validated against it in the service layer.';

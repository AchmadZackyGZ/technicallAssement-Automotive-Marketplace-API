CREATE TABLE listing_attributes (
  listing_id    UUID          NOT NULL REFERENCES listings(id)           ON DELETE CASCADE,
  definition_id UUID          NOT NULL REFERENCES filter_definitions(id) ON DELETE CASCADE,
  value_text    TEXT,
  value_num     NUMERIC(14,2),
  value_bool    BOOLEAN,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  PRIMARY KEY (listing_id, definition_id),

  CONSTRAINT listing_attributes_single_value_check CHECK (
    (value_text IS NOT NULL)::int + (value_num IS NOT NULL)::int + (value_bool IS NOT NULL)::int = 1
  )
);

CREATE INDEX listing_attributes_text_idx
  ON listing_attributes (definition_id, value_text) WHERE value_text IS NOT NULL;

CREATE INDEX listing_attributes_num_idx
  ON listing_attributes (definition_id, value_num) WHERE value_num IS NOT NULL;

CREATE INDEX listing_attributes_bool_idx
  ON listing_attributes (definition_id, value_bool) WHERE value_bool IS NOT NULL;

CREATE INDEX listing_attributes_listing_idx ON listing_attributes (listing_id);

CREATE TRIGGER listing_attributes_set_updated_at
BEFORE UPDATE ON listing_attributes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  listing_attributes IS 'EAV values for category-specific filter attributes; typed per definition.';
COMMENT ON COLUMN listing_attributes.definition_id IS 'Declares the key, type and unit; values are validated against it in the service layer.';

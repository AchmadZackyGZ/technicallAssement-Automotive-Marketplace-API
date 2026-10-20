CREATE TABLE listing_images (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID         NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url        TEXT         NOT NULL,
  alt_text   VARCHAR(200),
  position   SMALLINT     NOT NULL DEFAULT 0,
  is_primary BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT listing_images_url_check      CHECK (url ~* '^https?://'),
  CONSTRAINT listing_images_position_check CHECK (position >= 0)
);

CREATE INDEX listing_images_listing_idx ON listing_images (listing_id, position);

CREATE UNIQUE INDEX listing_images_one_primary_idx
  ON listing_images (listing_id) WHERE is_primary;

COMMENT ON TABLE listing_images IS 'Gallery images for a listing, ordered by `position`.';

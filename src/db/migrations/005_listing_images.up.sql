-- ===========================================================================
-- 005 - Listing images
-- ===========================================================================
-- A separate table (1:N) instead of a TEXT[] column: images need ordering, an
-- alt text for accessibility/SEO, and a "primary" flag that must be unique per
-- listing. That last constraint is impossible to express on an array column.
-- ===========================================================================

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

-- At most one cover image per listing.
CREATE UNIQUE INDEX listing_images_one_primary_idx
  ON listing_images (listing_id) WHERE is_primary;

COMMENT ON TABLE listing_images IS 'Gallery images for a listing, ordered by `position`.';

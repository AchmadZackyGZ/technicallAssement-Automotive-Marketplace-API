CREATE TABLE favorites (
  user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  listing_id UUID        NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, listing_id)
);

CREATE INDEX favorites_listing_idx ON favorites (listing_id);
CREATE INDEX favorites_user_created_idx ON favorites (user_id, created_at DESC);

COMMENT ON TABLE favorites IS 'Listings a buyer has saved.';

CREATE INDEX listings_title_trgm_idx ON listings USING GIN (title gin_trgm_ops);

COMMENT ON INDEX listings_title_trgm_idx IS 'Trigram index enabling index-backed substring matching on the listing title.';

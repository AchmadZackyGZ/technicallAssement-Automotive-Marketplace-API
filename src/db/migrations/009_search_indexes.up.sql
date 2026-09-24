-- ===========================================================================
-- 009 - Search indexes
-- ===========================================================================
-- The full-text implementation combines two complementary strategies:
--
--   1. tsvector / GIN  - handles stemming, word order and multi-word queries
--                        ("avanza 2019 jakarta"). Requires whole lexemes.
--   2. pg_trgm / GIN   - handles partial words and typos ("avan", "Toyata"),
--                        which full-text search cannot match because it works on
--                        complete lexemes.
--
-- Migration 004 already indexed make, model and location_city for trigram
-- matching (autocomplete). The search endpoint also matches on the listing
-- title, so the title needs the same treatment - otherwise `ILIKE '%avan%'`
-- would fall back to a sequential scan over the whole table.
-- ===========================================================================

CREATE INDEX listings_title_trgm_idx ON listings USING GIN (title gin_trgm_ops);

-- `description` is deliberately left out. It is the largest column, a trigram
-- index on it would be the biggest index in the schema, and substring matching
-- in free text is rarely what a buyer means. Description matches still work
-- through the weighted tsvector, which is where they belong (weight C).

COMMENT ON INDEX listings_title_trgm_idx IS 'Trigram index enabling index-backed substring matching on the listing title.';

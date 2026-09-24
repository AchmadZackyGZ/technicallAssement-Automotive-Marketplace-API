-- Revert 004 - Listings
DROP TRIGGER IF EXISTS listings_set_updated_at ON listings;
DROP TABLE IF EXISTS listings;

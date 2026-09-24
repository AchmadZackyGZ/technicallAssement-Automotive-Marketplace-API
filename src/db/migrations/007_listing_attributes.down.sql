-- Revert 007 - Listing attributes
DROP TRIGGER IF EXISTS listing_attributes_set_updated_at ON listing_attributes;
DROP TABLE IF EXISTS listing_attributes;

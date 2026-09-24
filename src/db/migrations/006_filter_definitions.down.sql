-- Revert 006 - Filter definitions
DROP VIEW IF EXISTS category_effective_filters;
DROP TRIGGER IF EXISTS filter_definitions_set_updated_at ON filter_definitions;
DROP TABLE IF EXISTS filter_definitions;

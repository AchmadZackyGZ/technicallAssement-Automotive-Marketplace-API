-- Revert 003 - Categories
DROP FUNCTION IF EXISTS categories_rebuild_subtree_paths(UUID, TEXT, SMALLINT, TEXT, SMALLINT);
DROP TRIGGER IF EXISTS categories_assign_path_trigger ON categories;
DROP FUNCTION IF EXISTS categories_assign_path();
DROP TRIGGER IF EXISTS categories_set_updated_at ON categories;
DROP TABLE IF EXISTS categories;

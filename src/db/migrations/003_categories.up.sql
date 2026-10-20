CREATE TABLE categories (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(140) NOT NULL,
  parent_id   UUID         REFERENCES categories(id) ON DELETE CASCADE,
  path        TEXT         NOT NULL,
  depth       SMALLINT     NOT NULL DEFAULT 0,
  description TEXT,
  icon        VARCHAR(60),
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT categories_name_check   CHECK (length(trim(name)) > 0),
  CONSTRAINT categories_slug_check   CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT categories_no_self_ref  CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT categories_depth_check  CHECK (depth >= 0)
);

CREATE UNIQUE INDEX categories_root_slug_unique_idx
  ON categories (slug) WHERE parent_id IS NULL;

CREATE UNIQUE INDEX categories_sibling_slug_unique_idx
  ON categories (parent_id, slug) WHERE parent_id IS NOT NULL;

CREATE INDEX categories_path_prefix_idx ON categories (path text_pattern_ops);
CREATE INDEX categories_parent_idx      ON categories (parent_id);
CREATE INDEX categories_depth_idx       ON categories (depth);
CREATE INDEX categories_sort_idx        ON categories (parent_id, sort_order, name);

CREATE INDEX categories_name_trgm_idx ON categories USING GIN (name gin_trgm_ops);

CREATE TRIGGER categories_set_updated_at
BEFORE UPDATE ON categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION categories_assign_path()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_path  TEXT;
  parent_depth SMALLINT;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path  := '/' || NEW.id::text || '/';
    NEW.depth := 0;
  ELSE
    SELECT c.path, c.depth
      INTO parent_path, parent_depth
      FROM categories c
     WHERE c.id = NEW.parent_id;

    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'Parent category % does not exist', NEW.parent_id
        USING ERRCODE = '23503';
    END IF;

    NEW.path  := parent_path || NEW.id::text || '/';
    NEW.depth := parent_depth + 1;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER categories_assign_path_trigger
BEFORE INSERT ON categories
FOR EACH ROW EXECUTE FUNCTION categories_assign_path();

CREATE OR REPLACE FUNCTION categories_rebuild_subtree_paths(
  p_root_id    UUID,
  p_old_prefix TEXT,
  p_old_depth  SMALLINT,
  p_new_prefix TEXT,
  p_new_depth  SMALLINT
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE categories
     SET path       = p_new_prefix || substring(path FROM length(p_old_prefix) + 1),
         depth      = p_new_depth + (depth - p_old_depth),
         updated_at = NOW()
   WHERE path LIKE p_old_prefix || '%'
     AND id <> p_root_id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

COMMENT ON TABLE  categories      IS 'Hierarchical vehicle category tree (adjacency list + materialized path).';
COMMENT ON COLUMN categories.path IS 'Materialized path of ancestor ids, self included: /root/child/self/';
COMMENT ON COLUMN categories.depth IS 'Distance from the root; roots are 0. Denormalised from path for cheap filtering.';

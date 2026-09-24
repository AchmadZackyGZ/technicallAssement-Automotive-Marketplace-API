-- ===========================================================================
-- 003 - Categories (hierarchical tree)
-- ===========================================================================
-- STRATEGY: Adjacency List + Materialized Path.
--
--   parent_id  -> adjacency list. Cheap writes, trivially readable, and the
--                 canonical way to express "has a parent" in a relational DB.
--   path       -> materialized path holding every ancestor id, e.g.
--                 '/<root-uuid>/<child-uuid>/<self-uuid>/'.
--
-- Why both?
--   * Fetching a whole subtree ("show me everything under Cars") with a plain
--     adjacency list needs a recursive CTE, which cannot use an index and gets
--     expensive at depth. With the materialized path the same query is a single
--     indexed prefix scan:  WHERE path LIKE '/<root-uuid>/%'
--   * Depth is unbounded - the requirement is "arbitrary depth". The path is
--     TEXT precisely so deep trees are not truncated by a VARCHAR limit.
--   * Writes stay cheap because only a moved subtree has to be rewritten, and
--     that is a single set-based UPDATE (see categories_rebuild_subtree_paths).
--
-- The path is derived, never trusted from the client: a BEFORE INSERT trigger
-- computes it, and the service recomputes the whole subtree when a node is
-- reparented. That guarantees the invariant no matter who writes to the table.
-- ===========================================================================

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

-- ---------------------------------------------------------------------------
-- Uniqueness of sibling slugs.
-- PostgreSQL treats NULLs as distinct, so a single UNIQUE(parent_id, slug)
-- would happily allow two roots both called "vehicles". Splitting the rule into
-- two partial indexes fixes that.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX categories_root_slug_unique_idx
  ON categories (slug) WHERE parent_id IS NULL;

CREATE UNIQUE INDEX categories_sibling_slug_unique_idx
  ON categories (parent_id, slug) WHERE parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Traversal indexes.
--
-- `text_pattern_ops` is what makes `path LIKE 'prefix%'` index-usable: under the
-- default collation a LIKE prefix scan cannot use a plain btree index.
-- ---------------------------------------------------------------------------
CREATE INDEX categories_path_prefix_idx ON categories (path text_pattern_ops);
CREATE INDEX categories_parent_idx      ON categories (parent_id);
CREATE INDEX categories_depth_idx       ON categories (depth);
CREATE INDEX categories_sort_idx        ON categories (parent_id, sort_order, name);

-- Fuzzy category lookup for autocomplete / typo tolerance.
CREATE INDEX categories_name_trgm_idx ON categories USING GIN (name gin_trgm_ops);

CREATE TRIGGER categories_set_updated_at
BEFORE UPDATE ON categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Derive `path` and `depth` on insert.
--
-- Column defaults (including gen_random_uuid()) are evaluated *before* a
-- BEFORE INSERT row trigger fires, so NEW.id is already populated here. That
-- lets the path include the node's own id in a single pass - no follow-up
-- UPDATE required.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Rewrite a subtree after a reparent operation.
--
-- Called by the service inside the same transaction that updates the moved
-- node. One set-based UPDATE rewrites every descendant: the suffix of each old
-- path is preserved and the new root prefix is prepended, while depth shifts by
-- the same delta the root moved by.
-- ---------------------------------------------------------------------------
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

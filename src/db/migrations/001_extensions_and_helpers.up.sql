-- ===========================================================================
-- 001 - Extensions and shared helper functions
-- ===========================================================================
-- Only one extension is genuinely required: pg_trgm powers fuzzy autocomplete
-- (ILIKE and similarity() over make / model / city) with a GIN index.
-- gen_random_uuid() is built into PostgreSQL 13+, so pgcrypto is not needed.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Generic `updated_at` maintenance.
-- Attached to every mutable table so the application never has to remember to
-- touch the column itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

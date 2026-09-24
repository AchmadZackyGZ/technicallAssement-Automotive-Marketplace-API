-- Revert 001 - Extensions and shared helper functions
DROP FUNCTION IF EXISTS set_updated_at();
-- pg_trgm is intentionally left installed: other databases in the cluster may
-- depend on it, and dropping an extension can be disruptive.

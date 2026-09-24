-- ===========================================================================
-- 002 - Users
-- ===========================================================================
-- Sellers own listings; buyers browse them. A single `role` column keeps the
-- model simple while leaving room for an admin/moderator role.
-- ===========================================================================

CREATE TABLE users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  phone         VARCHAR(30),
  role          VARCHAR(20)  NOT NULL DEFAULT 'seller',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT users_role_check   CHECK (role IN ('buyer', 'seller', 'admin')),
  CONSTRAINT users_email_check  CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT users_name_check   CHECK (length(trim(name)) > 0)
);

-- Email uniqueness must be case-insensitive: "Seller@Mail.com" and
-- "seller@mail.com" are the same account. A functional unique index does that
-- without forcing every writer to lowercase the value first.
CREATE UNIQUE INDEX users_email_lower_unique_idx ON users (LOWER(email));

CREATE INDEX users_role_idx      ON users (role);
CREATE INDEX users_created_at_idx ON users (created_at DESC);

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  users            IS 'Marketplace accounts (buyers, sellers, admins).';
COMMENT ON COLUMN users.role       IS 'buyer | seller | admin - drives authorisation checks.';
COMMENT ON COLUMN users.password_hash IS 'bcrypt hash; the plaintext password is never stored.';

#!/bin/sh
# ---------------------------------------------------------------------------
# Container entrypoint.
#
# Always applies migrations (they are idempotent - the runner records what has
# been applied in schema_migrations), then optionally seeds.
#
# SEED_ON_START=true is what makes `docker compose up` produce a fully working,
# populated API with no manual steps, which is the point of the compose file.
# Set it to false when you want to keep data you created through the API across
# restarts.
# ---------------------------------------------------------------------------
set -e

echo "[entrypoint] Applying migrations..."
node src/db/migrate.js up

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Seeding demo data (SEED_ON_START=true)..."
  node src/db/seed.js
else
  echo "[entrypoint] Skipping seed (set SEED_ON_START=true to populate demo data)."
fi

echo "[entrypoint] Starting: $*"
exec "$@"

# Troubleshooting

Problems that actually come up when running this project, and how to tell them
apart. Written from failures hit while building it, not from imagination.

---

## "The container logs stopped. It looks stuck."

### PostgreSQL is *supposed* to go quiet

This is the single most common false alarm. A healthy PostgreSQL container logs
roughly this and then nothing:

```
postgres  | PostgreSQL init process complete; ready for start up.
postgres  | LOG:  starting PostgreSQL 16.15 on x86_64-pc-linux-musl
postgres  | LOG:  listening on IPv4 address "0.0.0.0", port 5432
postgres  | LOG:  database system is ready to accept connections
postgres  | LOG:  checkpoint starting: time
postgres  | LOG:  checkpoint complete: wrote 776 buffers (4.7%); ...
```

`database system is ready to accept connections` means it is **up and healthy**.
After that it only speaks when something happens — a checkpoint, a slow query, a
shutdown. Silence is the success state.

The `initdb → CREATE DATABASE → shutting down → server started` sequence at the
very beginning is also normal: the official image initialises the cluster with a
temporary server, creates the database, stops it, then starts the real one.

### What to check instead

```bash
podman ps -a          # or: docker compose ps
```

Every service should be listed. Then look at the one you actually care about:

```bash
podman logs amp-api
podman logs amp-redis
```

If `amp-api` is missing entirely, the build failed — see below.
If it exists but is `Exited`, read its logs; the entrypoint prints what it is
doing before it dies.

### `podman compose up` shows logs from only one service

A real trap. `podman compose` on Windows delegates to an external provider —
`podman-compose` — and that provider does not always stream every service's
output to the terminal. The stack can be **fully up and healthy** while the
terminal shows only PostgreSQL, whose logs then go quiet, so it looks hung.

Confirm the truth with `podman ps` before concluding anything. If all services
say `Up`, the stack is fine and you are only missing the logs:

```bash
podman ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
podman logs -f amp-api
```

This is exactly how a working stack gets misdiagnosed as a hang. **`podman ps` is
the source of truth, not the log stream.**

---

## `podman machine start` says "already running" but nothing works

Symptom:

```
$ podman machine start
Error: unable to start podman-machine-default: "podman-machine-default" already running

$ podman compose up --build
Cannot connect to Podman. Please verify your connection to the Linux system ...
Error: unable to connect to Podman socket: dial tcp 127.0.0.1:50321:
       connectex: No connection could be made because the target machine actively refused it.
```

**Cause.** The machine's state file says `Running`, but the WSL VM (or its SSH
relay) is not actually up. Podman refuses to start a machine it believes is
already running, so it never recovers on its own. The port in the error is the
one recorded in
`%APPDATA%\containers\podman-connections.json` — if nothing is listening on it,
the VM is down regardless of what `machine start` claims.

**Fix, in order of escalation:**

```powershell
# 1. Force the stale state to clear, then start cleanly.
podman machine stop
podman machine start
podman info                      # must print system info before you continue

# 2. If `stop` reports it is not running, or hangs, restart WSL entirely.
wsl --shutdown
podman machine start
podman info

# 3. Still broken? The VM itself is corrupt. Nothing of value lives in it.
podman machine rm -f podman-machine-default
podman machine init --cpus 2 --memory 4096
podman machine start
podman info
```

Always confirm with `podman info` before building. If it does not print system
information, the socket is still down and `podman compose` will fail the same way.

To see what Podman currently thinks the socket is:

```powershell
podman system connection list
wsl -l -v
```

---

## `podman compose` fails about a missing provider

`podman compose` is a thin wrapper: it delegates to an external Compose
implementation. If neither is installed it cannot work.

```powershell
podman compose version     # see which provider is in use
```

If it reports none, either install one (`pip install podman-compose`) or skip
compose entirely and drive the containers directly:

```powershell
podman network create amp-net
podman volume create amp-pgdata

podman run -d --name amp-postgres --network amp-net `
  -e POSTGRES_USER=marketplace -e POSTGRES_PASSWORD=marketplace `
  -e POSTGRES_DB=automotive_marketplace `
  -v amp-pgdata:/var/lib/postgresql/data postgres:16-alpine

podman run -d --name amp-redis --network amp-net redis:7-alpine

podman build -t amp-api .

podman run -d --name amp-api --network amp-net -p 3000:3000 `
  -e DATABASE_URL=postgres://marketplace:marketplace@amp-postgres:5432/automotive_marketplace `
  -e REDIS_URL=redis://amp-redis:6379 `
  -e JWT_SECRET=local-compose-secret-not-for-production `
  -e NODE_ENV=production -e SEED_ON_START=true `
  amp-api

podman logs -f amp-api
```

This is the same stack the compose file describes, just written out.

---

## The API container never starts

Two things must be true first.

**PostgreSQL must be healthy.** The API waits on `condition: service_healthy`.
The image takes a few seconds to initialise; `start_period: 10s` covers it. If
PostgreSQL is genuinely broken, `podman logs amp-postgres` will say so.

**Redis must only be *started*, not healthy.** Redis here is an optional cache —
the API is explicitly designed to run without it, and degrades to querying
PostgreSQL directly. The compose file therefore uses `condition: service_started`
for Redis, not `service_healthy`. Waiting on Redis health would let a Redis
crash-loop block the entire stack: the API would sit idle forever waiting for a
dependency it does not actually need.

If the API container starts but exits immediately, read its logs — the entrypoint
prints each step (`Applying migrations...`, `Seeding demo data...`, `Starting:`)
before it hands over to Node.

---

## Port already in use

Defaults are `5432` (PostgreSQL), `6379` (Redis) and `3000` (API). If a local
PostgreSQL or another project already holds one, override it without editing the
file:

```powershell
$env:PGPORT=5433; $env:REDIS_PORT=6380; $env:API_PORT=3100
podman compose up --build
```

`API_PORT` only changes the published host port; the container always listens on
3000. It is deliberately *not* called `PORT`, because Compose substitutes
variables from the project's `.env` file — a developer with `PORT=3100` in their
local `.env` would otherwise get the API published on 3100 while the README, and
the container, both say 3000.

If the published port does not match what you expect, check it directly:

```bash
podman ps --format '{{.Names}}\t{{.Ports}}'
```

---

## `could not open file "base/…": Permission denied` from PostgreSQL

If you are running the stack in containers, this cannot happen — the database
owns its own filesystem. Seeing it means PostgreSQL is running directly on a host
where something (a sandbox, an antivirus, a filesystem overlay) is intercepting
its file access. It is an environment problem, not a schema or query problem: the
same query usually succeeds on retry. Run the database with no such interception
in the way, and delete and re-`initdb` the data directory if it was created under
different conditions.

---

## Checking whether the API is actually healthy

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "uptimeSeconds": 12,
  "checks": {
    "database": { "ok": true, "latencyMs": 1 },
    "cache": { "ok": true, "enabled": true, "latencyMs": 0 }
  }
}
```

- `database.ok: false` → the API returns **503**. It cannot serve without
  PostgreSQL.
- `cache.ok: false` with `enabled: true` → Redis is configured but unreachable.
  The API still returns **200** and serves from PostgreSQL; only the search
  endpoints lose their cache. This is by design.

Then confirm the seeded data is there:

```bash
curl "http://localhost:3000/api/v1/listings?limit=1"
```

A non-empty `data` array means migrations and seeding both ran.

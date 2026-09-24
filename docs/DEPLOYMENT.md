# Deployment

The API is a plain Node process with two managed dependencies (PostgreSQL and
Redis), so it deploys anywhere that can run `npm start` and inject a
`DATABASE_URL`. Railway is the target the brief asks for; the notes below are
Railway-specific but the environment variables are not.

---

## What the platform needs to do

1. Install dependencies — `npm ci --omit=dev`
2. Apply migrations before the server accepts traffic
3. Start the server — `node src/server.js`
4. Inject `DATABASE_URL`, `REDIS_URL` and `JWT_SECRET`
5. Probe `GET /health`

`railway.json` already encodes 1, 3 and 5. Step 2 is folded into the start
command (`node src/db/migrate.js up && node src/server.js`), which is safe
because the migration runner is idempotent: it records applied versions in
`schema_migrations` and skips them on subsequent boots.

---

## Railway, step by step

### 1. Create the project

```bash
npm i -g @railway/cli
railway login
railway init            # creates a project for this directory
```

Or, from the dashboard: **New Project → Deploy from GitHub repo** and pick this
repository. Railway will detect Node from `package.json` and use Nixpacks.

### 2. Add the databases

In the project canvas:

- **New → Database → Add PostgreSQL**
- **New → Database → Add Redis**

Both expose connection variables to the other services in the project.

### 3. Wire the environment variables

On the **API service → Variables**, reference the plugins rather than pasting
values, so credentials rotate with the database:

| Variable        | Value                                                  |
| --------------- | ------------------------------------------------------ |
| `DATABASE_URL`  | `${{Postgres.DATABASE_URL}}`                           |
| `REDIS_URL`     | `${{Redis.REDIS_URL}}`                                 |
| `JWT_SECRET`    | a long random string (see below)                       |
| `JWT_EXPIRES_IN`| `7d`                                                   |
| `NODE_ENV`      | `production`                                           |
| `API_PREFIX`    | `/api/v1`                                              |
| `CACHE_ENABLED` | `true`                                                 |
| `CORS_ORIGIN`   | `*` while evaluating, your front-end origin afterwards |

Generate the secret locally — never reuse the development one:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> `NODE_ENV=production` makes the config loader refuse to boot without
> `JWT_SECRET`, which is deliberate: a production deploy must never fall back to
> the development default.

`DATABASE_URL` on Railway's **private** network does not use TLS, so leave
`DB_SSL` unset. Set `DB_SSL=true` only if you point at the public proxy.

### 4. Apply migrations and seed once

Railway runs migrations on every boot, but the seed is a one-off. From a local
checkout linked to the project:

```bash
railway link
railway run npm run migrate     # usually already applied by the start command
railway run npm run seed        # 600 listings, ~2.700 images, ~2.000 attributes
```

`railway run` executes against the deployed database using the service's own
variables, so no connection string is copied around.

Seeding is destructive by design (it truncates marketplace tables and
regenerates them), so treat it as a setup step rather than something to re-run
against a live instance.

### 5. Verify

```bash
curl https://<your-service>.up.railway.app/health
```

Expect `{"status":"ok", ...}` with `checks.database.ok === true`. Then open
`https://<your-service>.up.railway.app/api/v1/docs` and try
`GET /listings` — no local setup required.

---

## Notes and trade-offs

**Migrations on boot.** Fine for a single-replica assessment deployment and it
removes a whole class of "forgot to migrate" failures. At scale you would run
migrations as a separate release step, so that N replicas do not race the same
`CREATE TABLE`.

**Redis is optional.** The API runs without it — every cache helper degrades to a
no-op — so a missing or misconfigured Redis degrades latency, not availability.
`/health` reports the cache but never fails because of it.

**Connection pooling.** The pool defaults to 10 connections. Railway's managed
PostgreSQL plan caps concurrent connections; raise `DB_POOL_MAX` only alongside
the plan, and remember `numReplicas × DB_POOL_MAX` is what the database actually
sees.

**Free-tier sleep.** Services on a trial plan may be paused when idle, so the
first request after a pause takes a few seconds. The healthcheck has a 120-second
timeout to accommodate that.

---

## Alternative platforms

Nothing here is Railway-specific beyond the variable-reference syntax.

| Platform | Notes |
| -------- | ----- |
| **Render** | `render.yaml` blueprint, or a Web Service with build `npm ci --omit=dev` and start `node src/db/migrate.js up && node src/server.js`. Render's managed PostgreSQL works as-is. |
| **Fly.io** | `fly launch` detects Node. Use `fly postgres create` / `fly redis create`, then `fly secrets set`. Set `internal_port = 3000` in `fly.toml`. |
| **Heroku** | Needs a Redis add-on; the `Procfile` equivalent is the start command above. |
| **Docker anywhere** | `docker compose up --build` from the repository root brings up the whole stack, including PostgreSQL and Redis. |

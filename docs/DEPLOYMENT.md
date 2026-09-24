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
| `PORT`          | `3000`                                                 |
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

> **`${{Postgres.DATABASE_URL}}` only resolves if a service named `Postgres`
> exists.** Add the plugins *before* wiring the variables. If the reference does
> not resolve, the variable becomes empty, the start command fails at
> `migrate`, and the service shows as **Crashed**.

#### Do NOT copy your local `.env`

This is the most common way a first deploy fails. Your `.env` points at your own
machine; the container cannot reach it.

| Local `.env` | Deployed value | Why |
| ------------ | -------------- | --- |
| `DATABASE_URL=postgres://…@localhost:55432/…` | `${{Postgres.DATABASE_URL}}` | `localhost` inside the container is the container itself |
| `REDIS_URL=` (empty) | `${{Redis.REDIS_URL}}` | empty disables caching — losing the bonus |
| `CACHE_ENABLED=false` | `true` | you *want* the cache in the deployed instance |
| `JWT_SECRET=local-dev-secret-…` | a fresh random secret | the dev secret is public in the repo history |
| `NODE_ENV=development` | `production` | production hides stack traces and enforces the JWT_SECRET guard |
| `BCRYPT_ROUNDS=8` | omit | 8 was only for fast local seeding; 10 is the default |
| `RATE_LIMIT_MAX=10000` | omit | a high limit was only for local test runs |

### 4. Apply migrations and seed once

Railway runs migrations on every boot, but the seed is a one-off. The simplest
route is the dashboard: **service → Console**, then

```bash
npm run seed
```

That runs inside the deployed container with its own variables already in the
environment — nothing to copy around.

From a local checkout instead:

```bash
railway link
railway run npm run migrate     # usually already applied by the start command
railway run npm run seed        # 600 listings, ~2.700 images, ~2.000 attributes
```

Seeding is destructive by design (it truncates marketplace tables and
regenerates them), so treat it as a setup step rather than something to re-run
against a live instance.

### 5. Expose the service publicly

**Railway does not create a public domain automatically.** Until you generate
one, the service shows **"Unexposed service"** and nothing can reach it — the
deployment looks broken while actually being fine.

```
Service → Settings → Networking → Public Networking → Generate Domain
```

Enter **the port your app is listening on** — `3000`, matching the `PORT`
variable set above. Railway pre-fills `8080`; that is only its own default, and
it must match `PORT` or the proxy will forward to a port nothing is listening on.

> If you would rather keep Railway's default, set `PORT=8080` instead and enter
> `8080`. What matters is that the two numbers agree.

Then verify the deployment before wiring it into the README.

### 6. Verify

```bash
curl https://<your-service>.up.railway.app/health
```

Expect `{"status":"ok", ...}` with `checks.database.ok === true`. Then open
`https://<your-service>.up.railway.app/api/v1/docs` and try
`GET /listings` — no local setup required.

---

## If the service shows "Crashed"

Railway restarts on failure, so a crash-loop usually means the start command is
exiting non-zero. The start command is
`node src/db/migrate.js up && node src/server.js`, and the most likely failure is
the migration step not reaching a database.

Check the deploy logs (service → Deployments → the deployment → **View logs**),
then work through:

| Symptom in the log | Cause | Fix |
| ------------------ | ----- | --- |
| `Missing required environment variable: JWT_SECRET` | `NODE_ENV=production` without a secret | set `JWT_SECRET` |
| `Either DATABASE_URL or PGHOST must be set` | no database configured | set `DATABASE_URL` |
| `getaddrinfo ENOTFOUND` / `ECONNREFUSED` on a database host | `DATABASE_URL` still points at `localhost`, or the `${{Postgres.…}}` reference did not resolve | add the PostgreSQL plugin, then re-add the variable as a reference |
| `Query failed … code: 28P01` | wrong credentials | the reference is pointing at a different service's database |
| Build fails on `npm ci` | lockfile out of sync with `package.json` | run `npm install` locally and commit the updated lockfile |

`/health` returning **503** after a successful boot means the process is up but
PostgreSQL is unreachable — again, almost always `DATABASE_URL`.

Two guards make these failures loud rather than silent, which is why they are
worth keeping:

- with `NODE_ENV=production`, the config loader **refuses to boot** without
  `JWT_SECRET`, so a deploy can never quietly run on the development secret;
- `/health` returns **503** when the database is unreachable, so Railway's
  healthcheck will not route traffic to an instance that cannot serve.

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

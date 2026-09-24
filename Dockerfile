# ============================================================================
# Automotive Marketplace API
#
# Two stages: production dependencies are installed in a throwaway layer, and
# only the resulting node_modules plus the source are copied into the runtime
# image. There is no build step (plain Node, no transpilation), so the runtime
# image stays small and starts in about a second.
# ============================================================================

# --- Stage 1: production dependencies ---------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first so this layer is only rebuilt when dependencies change,
# not on every source edit.
COPY package.json package-lock.json ./

# `npm ci` installs exactly the lockfile, and --omit=dev keeps eslint and
# nodemon out of the runtime image.
RUN npm ci --omit=dev --no-audit --no-fund


# --- Stage 2: runtime --------------------------------------------------------
FROM node:20-alpine AS runtime

# tini reaps zombies and forwards signals, so `docker stop` reaches Node and the
# graceful shutdown handler actually runs.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3000 \
    API_PREFIX=/api/v1

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

# The node image ships an unprivileged `node` user. Running as root inside a
# container is never necessary here.
USER node

EXPOSE 3000

# Uses Node's own fetch rather than curl/wget, which keeps the image free of
# extra packages. `--start-period` gives migrations time to finish on first boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]

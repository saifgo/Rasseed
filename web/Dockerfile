# syntax=docker/dockerfile:1

# ---- base ------------------------------------------------------------------
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dependencies ----------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ---- build the Next.js app -------------------------------------------------
FROM deps AS build
COPY . .
# public/ may be absent from a git checkout (the APK in it is optional).
RUN mkdir -p public && pnpm build && pnpm build:jobs

# ---- jobs: migrations, seed and the background worker ---------------------
# Bundled into single files by esbuild (same engine code as the web app), so no node_modules needed.
FROM node:22-alpine AS tools
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
USER node
CMD ["node", "dist/worker/index.js"]

# ---- web: minimal standalone server ---------------------------------------
FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DIR=/data/storage
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/api/health >/dev/null || exit 1
CMD ["node", "server.js"]

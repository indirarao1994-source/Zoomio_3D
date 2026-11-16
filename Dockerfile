# syntax=docker/dockerfile:1

# ── build ────────────────────────────────────────────────────────────────
# Node 24: the server runs .ts files directly via native type stripping, so
# the runtime must support it. Node 20 cannot, which is why the previous
# image started and immediately crashed on the first .ts import.
FROM node:24-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

# In order: typecheck, copy the ffmpeg.wasm core into public/ffmpeg, build the
# standalone tour player into server/player-dist, then build the studio.
RUN npm run build

# ── run ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# The server is TypeScript executed directly, so ship the sources rather than
# a compiled bundle. server/player-dist rides along inside this copy — without
# it every publish fails with "Player bundle is missing".
COPY --from=builder /app/server ./server
COPY --from=builder /app/dist ./dist
# Sample panoramas plus the ffmpeg core used by in-browser video export.
COPY --from=builder /app/public ./public

# Cloud Run injects PORT (usually 8080); the server already honours it.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "--experimental-strip-types", "server/index.ts"]

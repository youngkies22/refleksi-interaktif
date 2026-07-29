# syntax=docker/dockerfile:1
#
# Tiga tahap: build Vue → build server TypeScript → runtime ramping.
#
# Basis `node:22-bookworm-slim` (Debian glibc), BUKAN alpine. `better-sqlite3`
# butuh binding native; prebuilt binary-nya jauh lebih mulus di glibc, dan alpine
# (musl) sering memaksa kompilasi dari sumber yang gampang gagal di CI/Docker.
# build-essential + python3 tetap dipasang di stage build sebagai jaring pengaman
# kalau suatu saat tidak ada prebuilt binary yang cocok untuk arsitektur target.

##################################### 1) Build Vue #####################################
FROM node:22-bookworm-slim AS web-build
WORKDIR /app

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY shared ./shared
COPY web ./web
RUN cd web && npm run build

################################## 2) Build server TS ##################################
FROM node:22-bookworm-slim AS server-build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY shared ./shared
COPY src ./src
RUN npm run build

# Buang devDependencies (typescript, tsx, @types/*, pino-pretty) dari node_modules
# di tempat — better-sqlite3 sudah terkompilasi sekali di sini, tidak perlu diulang.
RUN npm prune --omit=dev

####################################### 3) Runtime ######################################
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/dist ./dist
COPY --from=web-build /app/web/dist ./web/dist
COPY package.json ./

# Image node resmi sudah menyediakan user/group non-root bernama "node".
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV DIR_DATA=/data
ENV DIR_WEB=/app/web/dist
ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/sehat').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/server.js"]

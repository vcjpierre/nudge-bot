# Prod para Railway: Node 22 + pnpm + better-sqlite3.
# tsc no copia los .sql de Drizzle, por eso se copian a dist/db/migrations.

FROM node:22-slim AS builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.14.0
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN mkdir -p dist/db/migrations && cp -r src/db/migrations/* dist/db/migrations/

FROM node:22-slim AS runner
RUN npm install -g pnpm@10.14.0
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/migrations ./dist/db/migrations
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "dist/index.js"]

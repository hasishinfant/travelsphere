# API image. Build context is the repository root, so the SQL migrations in supabase/ ship with it
# (Railway runs `node dist/migrate.js --local` before each deploy; see /railway.json).
FROM node:22-slim AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=build /app/server/package.json ./
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY supabase /app/supabase
CMD ["node", "dist/index.js"]

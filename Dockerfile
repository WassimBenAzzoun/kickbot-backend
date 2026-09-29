FROM node:24-alpine AS dependencies
WORKDIR /app

COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations/migration_lock.toml ./prisma/migrations/migration_lock.toml
COPY prisma/migrations/20260925000000_unified_nest_backend ./prisma/migrations/20260925000000_unified_nest_backend

ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=$DATABASE_URL
RUN --mount=type=cache,target=/root/.npm npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM dependencies AS migrate
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "prisma:migrate:deploy"]

FROM node:24-alpine AS production-dependencies
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/main.js"]

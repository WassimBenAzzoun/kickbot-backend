FROM node:24-alpine AS dependencies
WORKDIR /app

COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations

ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=$DATABASE_URL
RUN npm ci

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
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

ARG YT_DLP_VERSION=2026.09.16.232951
ARG YT_DLP_SHA256=f8ca14db511702a5dbfc5a527056312907ddd0914d0b4036f108d6849e17ef61
RUN apk add --no-cache ffmpeg python3 \
  && wget -q "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${YT_DLP_VERSION}/yt-dlp" -O /usr/local/bin/yt-dlp \
  && echo "${YT_DLP_SHA256}  /usr/local/bin/yt-dlp" | sha256sum -c - \
  && chmod 0555 /usr/local/bin/yt-dlp \
  && yt-dlp --version \
  && ffmpeg -version >/dev/null

COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/main.js"]

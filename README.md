# KickBot Backend

Backend and Discord bot services for Kick live notification delivery across Discord guilds.

This repository contains two production runtimes that share the same PostgreSQL + Prisma data layer:
- `src/api/main.ts`: Fastify API for Discord OAuth, dashboard data, guild management, and global admin controls
- `src/index.ts`: Discord bot runtime for polling, notifications, slash commands, presence rotation, and guild enforcement logic

## What This Repo Does

- authenticates dashboard users with Discord OAuth
- stores guild configuration and tracked streamers
- polls Kick and sends Discord notifications
- manages bot presence and global admin controls
- tracks guild membership state
- supports optional guild whitelist enforcement with auto-leave for non-whitelisted guilds

## Stack

- Node.js 20+
- TypeScript
- Fastify
- discord.js v14
- Prisma
- PostgreSQL
- Zod
- Pino
- Axios

## Related Repo

The dashboard frontend lives in a separate repository/worktree:
- `KickBot-Frontend`

This backend exposes the API and auth flow that frontend consumes.

## Environment Setup

Copy `.env.example` to `.env` and fill in the required values.
Copy `.env.example` to `.env` and fill in the required values.

### Core

- `NODE_ENV`
- `DATABASE_URL`
- `LOG_LEVEL`

### Discord Bot / Commands

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_COMMAND_GUILD_ID` optional
- `DISCORD_BOT_PERMISSIONS`

### Discord OAuth

- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `DISCORD_OAUTH_SCOPES`
- `DISCORD_GUILDS_CACHE_TTL_SECONDS`

### Kick API

- `KICK_CLIENT_ID`
- `KICK_CLIENT_SECRET`
- `KICK_API_BASE_URL`
- `KICK_TOKEN_URL`
- `KICK_SCOPES`
- `KICK_REQUEST_TIMEOUT_MS`
- `KICK_MAX_RETRIES`
- `KICK_RETRY_BASE_DELAY_MS`

### Runtime / API

- `POLL_INTERVAL_SECONDS`
- `PROVIDER_MAX_CONCURRENCY`
- `BOT_PRESENCE_SYNC_INTERVAL_SECONDS`
- `API_PORT`
- `API_BASE_URL`
- `FRONTEND_URL`
- `CORS_ORIGIN`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `SESSION_COOKIE_NAME`
- `OAUTH_STATE_COOKIE_NAME`
- `COOKIE_SECURE`
- `COOKIE_DOMAIN`
- `API_RATE_LIMIT_MAX`
- `API_RATE_LIMIT_WINDOW_SECONDS`

### Global Admin

- `GLOBAL_ADMIN_DISCORD_IDS`

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start PostgreSQL:

```bash
docker compose up -d postgres
```

3. Generate Prisma client and apply local migrations:

```bash
npm run prisma:generate
npm run prisma:migrate:dev
```

4. Register slash commands:

```bash
npm run register:commands
```

5. Run the API and bot:

```bash
npm run dev:api
npm run dev:bot
```

## Production Commands

Build:

```bash
npm run build
```

Run API:

```bash
npm run start:api
```

Run bot:

```bash
npm run start:bot
```

Docker:

```bash
docker compose up --build
```

Current compose services in this repo:
- `postgres`
- `migrate`
- `api`
- `bot`

## API Overview

### Auth

- `GET /auth/discord/login`
- `GET /auth/discord/callback`
- `POST /auth/logout`
- `GET /auth/me`

### Bot / Invite

- `GET /bot/invite-link`

### Dashboard

- `GET /dashboard/guilds`
- `GET /guilds/:guildId/config`
- `PUT /guilds/:guildId/config`
- `GET /guilds/:guildId/channels`
- `GET /guilds/:guildId/streamers`
- `POST /guilds/:guildId/streamers`
- `PATCH /guilds/:guildId/streamers/:streamerId`
- `DELETE /guilds/:guildId/streamers/:streamerId`
- `GET /guilds/:guildId/notifications?page=1&pageSize=20`

### Global Admin

- `GET /admin/global-config`
- `PUT /admin/global-config`
- `GET /admin/status-messages`
- `POST /admin/status-messages`
- `PUT /admin/status-messages/:id`
- `PATCH /admin/status-messages/:id/toggle`
- `PATCH /admin/status-messages/reorder`
- `DELETE /admin/status-messages/:id`
- `GET /admin/global-admins`
- `POST /admin/global-admins`
- `DELETE /admin/global-admins/:discordId`
- `GET /admin/bot-guilds`
- `POST /admin/bot-guilds/sync`
- `DELETE /admin/bot-guilds/:guildId/leave`
- `GET /admin/whitelist/guilds`
- `POST /admin/whitelist/guilds`
- `DELETE /admin/whitelist/guilds/:guildId`
- `GET /admin/settings/whitelist-enforcement`
- `PUT /admin/settings/whitelist-enforcement`

## Guild Whitelist Enforcement

Invite generation is still normal. The restriction is enforced after the bot joins a guild.

- If whitelist enforcement is off:
  - the bot stays in any guild
- If whitelist enforcement is on:
  - the bot checks whether the guild id exists in `WhitelistedGuild`
  - if it is not whitelisted, the bot leaves automatically
  - startup reconciliation also removes any existing non-whitelisted guilds

When a guild is removed from the whitelist while enforcement is enabled, the API also attempts immediate eviction.

## Data Model Highlights

- `GuildConfig`
- `TrackedStreamer`
- `NotificationHistory`
- `GlobalBotConfig`
- `BotStatusMessage`
- `GlobalAdmin`
- `BotGuildState`
- `AppSetting`
- `WhitelistedGuild`

## Notes

- OAuth sessions are cookie-based, so frontend requests must use `credentials: include`.
- Backend auth callback should redirect to the frontend callback route configured by `FRONTEND_URL`.
- Whitelist enforcement is enforced by backend + bot runtime, not by frontend UI.

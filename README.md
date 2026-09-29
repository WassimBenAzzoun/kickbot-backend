# KickBot Backend

One NestJS application that serves the dashboard API and runs the Discord/Kick notification bot. Fastify listens on port `4000`; Necord connects to Discord through an outbound gateway connection and does not open another port.

## Stack

- Node.js 24, TypeScript 6, ESM
- NestJS 12.1 with Fastify and Necord 7
- Discord.js 14, Prisma 7, PostgreSQL
- Zod 4 Standard Schema validation and OpenAPI
- Vitest, Oxlint, and Prettier

TypeScript 6 is intentional: `@nestjs/swagger` 12 currently declares support for TypeScript 5.5 and 6, so TypeScript 7 would create an invalid peer dependency graph.

## Local setup

1. Copy `.env.example` to `.env` and provide Discord, Kick, database, and session credentials.
2. Start a local PostgreSQL instance matching `DATABASE_URL` (or run the entire stack with Docker Compose).
3. Install and prepare a host-run database:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

4. Start the unified application:

```bash
npm run start:dev
```

Set `DISCORD_DEVELOPMENT_GUILD_ID` during development for immediate guild-command registration. Leave it empty to register global commands. Set `DISCORD_ENABLED=false` for HTTP-only tests.

## API

All application routes use the `/api/v1` prefix:

- `/auth/discord/login`, `/auth/discord/callback`, `/auth/logout`, `/auth/me`
- `/bot/invite-url`
- `/guilds` and nested channels, streamers, and notifications routes
- `/admin/settings`, `/admin/presence-messages`, `/admin/admins`, `/admin/guilds`
- `/health/live` and `/health/ready`

OpenAPI is served at `/api/docs` and `/api/docs-json`. The API uses encrypted JWE session cookies, origin-based CSRF protection, explicit credentialed CORS, security headers, request IDs, and rate limiting.

See the [HTTP API reference](docs/API.md) for authentication, response conventions, endpoint coverage, pagination, and request examples. Swagger includes request schemas, response schemas, error contracts, cookie authentication, tags, and operation descriptions.

## Discord commands

Necord discovers and registers `/ping`, `/help`, `/config channel|view`, and `/streamer add|remove|enable|disable|list`. Configuration commands require the Discord `Manage Server` permission.

## Verification

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
npm audit --omit=dev
```

## Docker

`docker compose up --build` runs three services: PostgreSQL, a one-shot Prisma migration, and the unified backend. Only port `4000` is published.

The migration history is a clean v2 baseline. It is intentionally incompatible with the former development schema and data.

## Heroku with Supabase Postgres

The project includes a `heroku.yml` container manifest. It builds the `runtime` Docker stage as the single web process and runs the `migrate` stage during Heroku's release phase. Use exactly one always-on web dyno because that process also owns the Discord gateway connection and scheduled jobs.

See the [Heroku and Supabase deployment guide](docs/HEROKU.md) for the Supabase Session pooler URL, SSL requirements, config variables, deployment steps, and health checks.

# Heroku deployment with Supabase Postgres

Heroku runs one container containing the NestJS API, Necord Discord bot, and scheduled Kick polling. Supabase provides PostgreSQL; no Heroku Postgres add-on is required.

## 1. Prepare Supabase

Create a Supabase project, then open **Connect** in its dashboard and copy the **Session pooler** connection string on port `5432`. This endpoint is IPv4-compatible and supports the prepared statements used by this persistent Prisma backend.

Use the copied host and project reference; do not construct them from the region. Replace the password placeholder with the database password, percent-encode reserved characters in that password, and add `sslmode=require`:

```text
postgresql://postgres.PROJECT_REF:PERCENT_ENCODED_PASSWORD@POOLER_HOST:5432/postgres?sslmode=require
```

The same `DATABASE_URL` is used by the release migration and the running application. Do not use the transaction pooler on port `6543` for this deployment.

The backend connects directly through Prisma and does not use the Supabase Data API. The baseline migration enables Row Level Security on every application table without granting anonymous Data API policies. If the Data API is not needed for anything else in the project, disable it in Supabase's API settings as an additional safeguard.

## 2. Create the Heroku app

From this repository, create a Cedar container-stack app (or configure an existing app):

```bash
heroku create YOUR_APP_NAME --stack container
# Existing app only:
heroku stack:set container --app YOUR_APP_NAME
```

The committed `heroku.yml` builds two targets from `Dockerfile`:

- `release` runs `prisma migrate deploy` before a release becomes active.
- `web` starts the unified NestJS and Necord process.

Heroku supplies `PORT` automatically. Do not set it manually.

## 3. Configure production variables

Set the database URL as a Heroku config var and never commit its real value:

```bash
heroku config:set DATABASE_URL="YOUR_SUPABASE_SESSION_POOLER_URL_WITH_SSLMODE_REQUIRE" --app YOUR_APP_NAME
```

Set the application configuration with real values:

The multiline example below uses Bash. In PowerShell, replace each trailing `\` with a backtick, or set the same values in the Heroku dashboard.

```bash
heroku config:set \
  NODE_ENV=production \
  LOG_LEVEL=log \
  DISCORD_ENABLED=true \
  DISCORD_TOKEN="YOUR_DISCORD_BOT_TOKEN" \
  DISCORD_CLIENT_ID="YOUR_DISCORD_CLIENT_ID" \
  DISCORD_CLIENT_SECRET="YOUR_DISCORD_CLIENT_SECRET" \
  DISCORD_BOT_PERMISSIONS=3230720 \
  DISCORD_REDIRECT_URI="https://YOUR_APP_NAME.herokuapp.com/api/v1/auth/discord/callback" \
  KICK_CLIENT_ID="YOUR_KICK_CLIENT_ID" \
  KICK_CLIENT_SECRET="YOUR_KICK_CLIENT_SECRET" \
  SPOTIFY_CLIENT_ID="YOUR_SPOTIFY_CLIENT_ID" \
  SPOTIFY_CLIENT_SECRET="YOUR_SPOTIFY_CLIENT_SECRET" \
  SESSION_ENCRYPTION_KEY="A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS" \
  FRONTEND_URL="https://YOUR_FRONTEND_DOMAIN" \
  CORS_ORIGINS="https://YOUR_FRONTEND_DOMAIN" \
  COOKIE_SECURE=true \
  SWAGGER_UI_ENABLED=false \
  GLOBAL_ADMIN_DISCORD_IDS="YOUR_DISCORD_USER_ID" \
  --app YOUR_APP_NAME
```

Leave `COOKIE_DOMAIN` unset unless the frontend and API intentionally share a parent domain. Set any optional polling, presence, OAuth-scope, rate-limit, and cookie-name variables from `.env.example` when their defaults are not suitable.

The container runtime installs FFmpeg, ffprobe, Python, and the pinned yt-dlp zipapp. Instants and music remain disabled after the additive database migration. After deploying, update the bot permission integer to `3230720`, regenerate or reopen the bot invite, and reauthorize it in existing guilds so it receives **Connect** and **Speak**. Verify both Myinstants and YouTube access from the dyno before enabling the feature. If either provider challenges the Heroku egress address, keep voice playback disabled; do not add account cookies or anti-blocking workarounds.

Update the Discord application's OAuth redirect allowlist with the exact `DISCORD_REDIRECT_URI` value.

## 4. Deploy and constrain the process

Deploy from Git or connect the repository in the Heroku dashboard. For a CLI Git deployment:

```bash
git push heroku main
```

Run exactly one always-on web dyno and keep Preboot disabled. Multiple dynos would create duplicate Discord gateway sessions, polling cycles, and notifications; Preboot temporarily overlaps old and new web dynos during deployment.

```bash
heroku ps:scale web=1 --app YOUR_APP_NAME
heroku features:disable preboot --app YOUR_APP_NAME
```

Use a Basic or higher always-on dyno. An Eco dyno sleeps after inactivity, which disconnects the Discord gateway and stops scheduled polling.

## 5. Verify

Watch the release migration and application startup:

```bash
heroku releases:output --app YOUR_APP_NAME
heroku logs --tail --app YOUR_APP_NAME
```

Then verify the public endpoints:

```bash
curl https://YOUR_APP_NAME.herokuapp.com/api/v1/health/live
curl https://YOUR_APP_NAME.herokuapp.com/api/v1/health/ready
curl https://YOUR_APP_NAME.herokuapp.com/api/docs-json
```

Readiness is healthy only when PostgreSQL, Discord, and the scheduler are ready. It reports `instants: disabled` and `music: disabled` while the shared feature is off; enabled mode additionally requires Discord voice, ffprobe, and yt-dlp. Spotify credentials are optional for YouTube-only playback. The Swagger UI is disabled by the production example, while the OpenAPI JSON contract remains available.

# done.md

## Guild Whitelist Enforcement Added

### Schema Changes
- Added Prisma enum:
  - `AppSettingKey`
- Added Prisma models:
  - `AppSetting`
  - `WhitelistedGuild`
- Added migration:
  - `prisma/migrations/20260406123000_guild_whitelist_enforcement/migration.sql`

### Backend Routes Added
- Added global-admin-only whitelist routes:
  - `GET /admin/whitelist/guilds`
  - `POST /admin/whitelist/guilds`
  - `DELETE /admin/whitelist/guilds/:guildId`
- Added global-admin-only whitelist setting routes:
  - `GET /admin/settings/whitelist-enforcement`
  - `PUT /admin/settings/whitelist-enforcement`

### Services / Repositories Added
- Added repositories:
  - `src/repositories/appSettingRepository.ts`
  - `src/repositories/whitelistedGuildRepository.ts`
- Added services:
  - `src/services/guildWhitelistSettingsService.ts`
  - `src/services/whitelistedGuildService.ts`
  - `src/services/guildWhitelistEnforcementService.ts`

### Bot Events / Hooks Added
- Added `src/events/registerGuildWhitelistEvents.ts` to enforce the whitelist on `GuildCreate`.
- Updated `src/events/registerReadyEvent.ts` to run startup whitelist reconciliation after guild state sync.
- Updated `src/index.ts` to register the new whitelist enforcement service and event hook.

### Behavior Implemented
- Invite link behavior remains unchanged.
- If whitelist enforcement is OFF:
  - bot stays in any guild it joins
- If whitelist enforcement is ON:
  - bot checks `WhitelistedGuild` on guild join
  - bot automatically leaves non-whitelisted guilds
  - bot reconciles existing guilds on startup and leaves non-whitelisted ones
- Immediate leave on whitelist removal was implemented from the admin API:
  - if a guild is removed from the whitelist while enforcement is enabled
  - the API attempts to make the bot leave immediately

### Logging / Auditability
- Added structured logs for:
  - guild join detection
  - whitelist evaluation results
  - guild auto-leave actions
  - whitelist add/remove operations
  - whitelist enforcement setting changes

### Known Limitations
- Immediate eviction on whitelist removal uses the bot token through the API service; if Discord API calls fail temporarily, the guild may remain until the next successful reconciliation or restart.
- Full dashboard UI screens for whitelist management were not built in this pass, but the backend API contract is now ready for frontend integration.

## Production VPS Automation Added

### New Bash Deployment System
- Added a production-focused Bash operations layer under `scripts/` for Ubuntu VPS deployments:
  - `scripts/setup-server.sh`
  - `scripts/deploy.sh`
  - `scripts/update.sh`
  - `scripts/logs.sh`
  - `scripts/backup.sh`
  - `scripts/rollback.sh`
  - shared helper library: `scripts/lib/common.sh`
- All scripts now use consistent colored logging, strict Bash mode, idempotent checks, env validation, and shared runtime helpers for:
  - `log_info`
  - `log_success`
  - `log_warning`
  - `log_error`
  - `check_command`
  - `check_env`
  - `wait_for_service`

### What setup-server.sh Does
- Updates Ubuntu packages with `apt update` and `apt upgrade -y`.
- Installs required system packages:
  - `curl`
  - `git`
  - `ufw`
  - `ca-certificates`
  - `gnupg`
  - `lsb-release`
  - `unzip`
- Installs Docker using Docker's official Ubuntu repository:
  - `docker-ce`
  - `docker-ce-cli`
  - `containerd.io`
  - `docker-buildx-plugin`
  - `docker-compose-plugin`
- Enables Docker, adds the target user to the `docker` group, and prints the `newgrp docker` reminder.
- Configures UFW for:
  - `OpenSSH`
  - `80/tcp`
  - `443/tcp`
- Installs Node.js LTS from NodeSource by default.
- Creates the application directory and `/backups/kick-platform`.
- Supports optional SSH hardening with `--disable-password-ssh`.

### How to Run setup-server.sh
1. Copy the repo to the server or clone it there.
2. Run:
   - `chmod 750 scripts/*.sh scripts/lib/common.sh`
   - `./scripts/setup-server.sh`
3. Optional hardening:
   - `./scripts/setup-server.sh --disable-password-ssh`
4. Optional custom directory:
   - `./scripts/setup-server.sh --project-dir=/home/your-user/kick-platform`

### How to Deploy
- Ensure `.env` exists in the app root and contains the required production values.
- First deploy from an existing checkout:
  - `./scripts/deploy.sh`
- First deploy while cloning on the server:
  - `APP_DIR=/home/your-user/kick-platform ./scripts/deploy.sh --repo-url=https://github.com/you/your-repo.git --branch=main`
- Useful flags:
  - `--skip-build`
  - `--only=api`
  - `--only=api,bot`
  - `--no-migrate`
  - `--register-commands`
- Deployment flow:
  - validates `.env`
  - syncs the git checkout when available
  - builds Docker images
  - starts PostgreSQL
  - runs Prisma migrations
  - starts selected services
  - calls `/health` and requires HTTP 200 before reporting success

### How to Update
- Run:
  - `./scripts/update.sh`
- Useful flags:
  - `--force`
  - `--skip-build`
  - `--only=api,bot`
  - `--no-migrate`
  - `--register-commands`
- Update flow:
  - fetches and pulls the target branch
  - rebuilds changed containers
  - runs migrations
  - restarts selected services with Docker Compose
  - verifies the API health endpoint

### How to View Logs
- Stream one service:
  - `./scripts/logs.sh api`
  - `./scripts/logs.sh frontend`
  - `./scripts/logs.sh bot`
- Stream everything:
  - `./scripts/logs.sh all`

### How Backups Work
- Create a backup:
  - `./scripts/backup.sh`
- Optional flags:
  - `--backup-dir=/backups/kick-platform`
  - `--retention=7`
- Backup behavior:
  - parses `DATABASE_URL`
  - runs `pg_dump` inside the PostgreSQL container
  - writes timestamped `.sql.gz` files
  - keeps only the most recent 7 backups by default

### How Rollback Works
- Roll back to the previous recorded deployment:
  - `./scripts/rollback.sh`
- Roll back to a specific commit:
  - `./scripts/rollback.sh --commit=<sha>`
- Roll back when no previous marker exists:
  - `./scripts/rollback.sh --force`
- Rollback behavior:
  - checks out the previous successful release (or a specific commit)
  - rebuilds containers
  - restarts services
  - runs migrations unless `--no-migrate` is supplied
  - re-checks API health
- Important note:
  - database schema rollback is not automatic; this script rolls back application code and container images only

### Security and Ops Notes
- `.env` is validated but never printed.
- Backup archives and deploy state files are written with restrictive permissions.
- Added `.deploy/` to `.gitignore` for release markers and deployment state.
- Updated `docker-compose.yml` so PostgreSQL binds to `127.0.0.1:5432` instead of all interfaces, which keeps the database off the public network even if a host firewall rule changes later.
- The current compose file in this repo still only defines:
  - `postgres`
  - `migrate`
  - `api`
  - `bot`
- The new scripts warn cleanly if optional services like `frontend` or `caddy` are not present yet, so you can add them later without rewriting the operational tooling.

## Completed in This Update

### Frontend UI Rework Completed
- Fully redesigned the frontend experience for the Discord + Kick dashboard with a real SaaS-style app shell:
  - persistent left navigation
  - dedicated guild avatar switcher rail
  - responsive mobile sheet navigation
  - polished top header bar
- Rebuilt the core product pages around reusable components instead of page-specific CSS:
  - overview dashboard
  - guild settings / management
  - streamers management
  - notifications history
  - setup / onboarding
  - account / profile
  - login
- Preserved backend compatibility while refactoring the frontend architecture around:
  - React Query data loading + cache invalidation
  - guild normalization helpers
  - token-based Tailwind + shadcn styling
  - lazy-loaded routes for better frontend chunking

### Components Added / Refactored
- Added/refactored reusable frontend building blocks such as:
  - `AppSidebar`
  - `GuildSwitcher`
  - `GuildAvatar`
  - `DashboardTopbar`
  - `DashboardHeader`
  - `SummaryCard`
  - `EmptyState`
  - `LoadingSkeleton`
  - `GuildSettingsCard`
  - `StreamerTable`
  - `NotificationHistoryTable`
  - `AddStreamerDialog`
  - `BotStatusBadge`
  - `SetupChecklist`
  - `MobileNav`
- Added a query/client + utility layer for:
  - dashboard query keys
  - guild normalization
  - formatting helpers
  - shared Tailwind/shadcn utilities

### Guild Image Rendering Fixed Properly
- Fixed guild icon rendering by centralizing guild identity handling in a normalization layer instead of relying on raw API fields inside page components.
- Frontend guild rendering now supports multiple possible field shapes:
  - `guildId` / `id`
  - `guildName` / `name`
  - `iconUrl`
  - `image`
  - `avatar`
  - `icon` / `iconHash` for Discord CDN fallback construction
- Added robust image URL normalization so frontend rendering now handles:
  - full `https://` URLs
  - protocol-relative URLs
  - raw `cdn.discordapp.com/...` values
  - Discord CDN generation from guild id + icon hash when needed
- Added reusable `GuildAvatar` fallback behavior so if an icon is missing or fails to load:
  - rendering no longer breaks
  - initials avatar fallback is shown consistently
  - sidebar, cards, and guild headers all stay visually correct
- This means the guild image issue was fixed at the data-mapping + rendering layer, not by cosmetic one-off tweaks.

### Frontend Foundation Improvements
- Added Tailwind v4 + shadcn-compatible theme tokens and `components.json` for cleaner future theming/tweakcn work.
- Added route-level code splitting to reduce the initial frontend bundle.
- Added a compatibility styling layer so the existing global admin screen still works inside the new app shell while the rest of the product UI is fully redesigned.

### What Still Could Be Improved Later
- Convert the remaining legacy global admin page from compatibility styling to the same fully modular component system used by the new dashboard pages.
- Add richer cross-guild analytics if backend endpoints are expanded to provide global notifications/activity summaries.
- Add optimistic UI for more mutations and deeper filtering/sorting controls for streamers and notification history if needed.

### Global Admin API + UI Finished
- Completed global admin page in frontend with:
  - global config form
  - status message create/edit/delete/toggle/reorder
  - global admin user management (add/remove)
  - bot guild management list with leave action
- Added frontend route guard and nav visibility for global admins only.

### Global Admin User Management (Backend)
- Added protected routes:
  - `GET /admin/global-admins`
  - `POST /admin/global-admins`
  - `DELETE /admin/global-admins/:discordId`
- Added backend logic to:
  - combine env-managed global admins + DB global admins
  - block deletion of env-managed admins from API
  - block self-removal in route guard logic

### Persisted Bot Guild State
- Added Prisma model `BotGuildState` and migration `20260405223000_bot_guild_state`.
- Added repository/service to persist bot guild join/leave/seen state.
- Bot runtime now records guild state:
  - sync on startup (ready event)
  - update on `GuildCreate`
  - update on `GuildDelete`

### Global Admin Bot Guild Operations
- Added protected routes:
  - `GET /admin/bot-guilds`
  - `POST /admin/bot-guilds/sync`
  - `DELETE /admin/bot-guilds/:guildId/leave`
- Implemented Discord bot guild sync from official Discord API using bot token.
- Implemented leave-guild action from API and reflected it in persisted state.
- Bot guild list returned to global admins includes guild settings context:
  - configured alert channel id
  - tracked streamer count

### Auth Contract Improvement
- `GET /auth/me` now returns `isGlobalAdmin`.
- Frontend uses this field to render admin navigation and protect `/dashboard/admin`.

## Files Added
- `src/repositories/botGuildStateRepository.ts`
- `src/services/botGuildStateService.ts`
- `src/events/registerGuildStateEvents.ts`
- `prisma/migrations/20260405223000_bot_guild_state/migration.sql`

## Files Updated
- `prisma/schema.prisma`
- `src/shared/appContext.ts`
- `src/repositories/globalAdminRepository.ts`
- `src/services/globalAdminService.ts`
- `src/api/types/discord.ts`
- `src/api/services/discordApiService.ts`
- `src/api/dto/adminDto.ts`
- `src/api/dto/authDto.ts`
- `src/api/routes/authRoutes.ts`
- `src/api/routes/adminRoutes.ts`
- `src/events/registerReadyEvent.ts`
- `src/index.ts`
- `README.md`
- `KickBot-Frontend/src/app/lib/api.ts`
- `KickBot-Frontend/src/app/components/DashboardLayout.tsx`
- `KickBot-Frontend/src/app/routes.tsx`
- `KickBot-Frontend/src/app/pages/GlobalAdminPage.tsx`

## Build/Validation
- Backend Prisma client generation: passed after unlocking node process file lock.
- Backend TypeScript build: passed.
- Frontend TypeScript + Vite build: passed.

## What You Need To Run Now
1. Apply DB migration:
   - `npm run prisma:migrate:dev`
2. Start backend API:
   - `npm run dev:api`
3. Start bot runtime:
   - `npm run dev:bot`
4. Start frontend:
   - in `KickBot-Frontend`: `npm run dev`
5. Logout/login once to refresh `isGlobalAdmin` in session payload.

## Notes
- Global admin endpoints are server-enforced; guild admins cannot access them.
- Env-based admins (`GLOBAL_ADMIN_DISCORD_IDS`) appear in admin user list as `source=env` and are not removable from UI/API.

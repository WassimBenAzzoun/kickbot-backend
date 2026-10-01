# KickBot HTTP API

The backend serves versioned JSON endpoints under `/api/v1`. Interactive Swagger documentation is available at `/api/docs`; the OpenAPI JSON contract is always available at `/api/docs-json` when the server is running.

## Authentication

1. Open `GET /api/v1/auth/discord/login` in a browser.
2. Complete Discord OAuth.
3. The callback sets the encrypted `kickbot_session` cookie and redirects to the configured frontend.
4. Send that cookie with protected API requests. Browser clients must use credentials mode (`credentials: "include"`).
5. Call `POST /api/v1/auth/logout` to clear authentication cookies.

The cookie name is configurable through `SESSION_COOKIE_NAME`. Cookies are HTTP-only, `SameSite=Lax`, scoped to `/`, and secure in production.

## Response conventions

Entity endpoints return the entity directly. Collections use:

```json
{
  "items": [],
  "page": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

Errors use:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable explanation",
    "details": {},
    "requestId": "request-id"
  }
}
```

Dates are ISO-8601 strings. Successful delete and reorder operations return `204 No Content`.

## Endpoints

| Method       | Path                                              | Authentication            | Purpose                                                         |
| ------------ | ------------------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| GET          | `/api/v1/auth/discord/login`                      | No                        | Start Discord OAuth                                             |
| GET          | `/api/v1/auth/discord/callback`                   | OAuth state               | Finish OAuth and create a session                               |
| POST         | `/api/v1/auth/logout`                             | No                        | Clear authentication cookies                                    |
| GET          | `/api/v1/auth/me`                                 | Session                   | Return `{ id, username, globalName, avatarUrl, isGlobalAdmin }` |
| GET          | `/api/v1/bot/invite-url`                          | No                        | Return the Discord bot installation URL                         |
| GET          | `/api/v1/guilds`                                  | Session                   | List manageable Discord guilds                                  |
| GET          | `/api/v1/guilds/:guildId`                         | Session + Manage Guild    | Read a guild configuration                                      |
| PATCH        | `/api/v1/guilds/:guildId`                         | Session + Manage Guild    | Set or clear the alert channel                                  |
| GET          | `/api/v1/guilds/:guildId/channels`                | Session + Manage Guild    | List eligible alert channels                                    |
| GET          | `/api/v1/guilds/:guildId/streamers`               | Session + Manage Guild    | List tracked Kick streamers                                     |
| POST         | `/api/v1/guilds/:guildId/streamers`               | Session + Manage Guild    | Track a Kick streamer                                           |
| PATCH        | `/api/v1/guilds/:guildId/streamers/:streamerId`   | Session + Manage Guild    | Enable or disable tracking                                      |
| DELETE       | `/api/v1/guilds/:guildId/streamers/:streamerId`   | Session + Manage Guild    | Remove tracking                                                 |
| GET          | `/api/v1/guilds/:guildId/notifications`           | Session + Manage Guild    | List delivered notification history                             |
| GET          | `/api/v1/guilds/:guildId/instants/capabilities`   | Session + Manage Guild    | Read access, voice readiness, and limits                        |
| GET          | `/api/v1/guilds/:guildId/instants/voice-channels` | Session + Manage Guild    | List normal channels where the bot can connect and speak        |
| GET          | `/api/v1/guilds/:guildId/instants/search`         | Session + playback access | Search Myinstants by text                                       |
| POST         | `/api/v1/guilds/:guildId/instants/queue`          | Session + playback access | Resolve a Myinstants page and queue it in voice                 |
| GET          | `/api/v1/guilds/:guildId/instants/queue`          | Session + Manage Guild    | Read the process-local playback queue                           |
| DELETE       | `/api/v1/guilds/:guildId/instants/queue`          | Session + Manage Guild    | Stop and clear Instants without stopping music                  |
| GET          | `/api/v1/guilds/:guildId/music/capabilities`      | Session + Manage Guild    | Read music access, source readiness, and limits                 |
| POST         | `/api/v1/guilds/:guildId/music/queue`             | Session + playback access | Resolve and queue a YouTube or Spotify URL                      |
| GET          | `/api/v1/guilds/:guildId/music/queue`             | Session + Manage Guild    | Read current music playback and the FIFO queue                  |
| POST         | `/api/v1/guilds/:guildId/music/pause`             | Session + playback access | Pause music playback                                            |
| POST         | `/api/v1/guilds/:guildId/music/resume`            | Session + playback access | Resume music playback                                           |
| POST         | `/api/v1/guilds/:guildId/music/skip`              | Session + playback access | Skip the current track                                          |
| DELETE       | `/api/v1/guilds/:guildId/music/queue`             | Session + playback access | Stop music and clear only the music queue                       |
| GET/PATCH    | `/api/v1/admin/settings`                          | Global admin              | Read or update bot settings                                     |
| GET/POST     | `/api/v1/admin/presence-messages`                 | Global admin              | List or create presence messages                                |
| PATCH/DELETE | `/api/v1/admin/presence-messages/:id`             | Global admin              | Update or delete a presence message                             |
| PATCH        | `/api/v1/admin/presence-messages/order`           | Global admin              | Replace presence ordering                                       |
| GET/POST     | `/api/v1/admin/admins`                            | Global admin              | List or add global administrators                               |
| DELETE       | `/api/v1/admin/admins/:discordId`                 | Global admin              | Remove a database administrator                                 |
| GET          | `/api/v1/admin/guilds`                            | Global admin              | List every known guild                                          |
| POST         | `/api/v1/admin/guilds/sync`                       | Global admin              | Reconcile guilds with Discord                                   |
| POST         | `/api/v1/admin/guilds/:guildId/leave`             | Global admin              | Make the bot leave a guild                                      |
| PATCH        | `/api/v1/admin/guilds/:guildId/access`            | Global admin              | Change allowlist access                                         |
| GET/PATCH    | `/api/v1/admin/instants/settings`                 | Global admin              | Read or update the Instants kill switch and access mode         |
| GET/POST     | `/api/v1/admin/instants/allowed-users`            | Global admin              | List or add globally allowed Discord users                      |
| DELETE       | `/api/v1/admin/instants/allowed-users/:discordId` | Global admin              | Remove an allowed Discord user                                  |
| GET          | `/api/v1/health/live`                             | No                        | Process liveness                                                |
| GET          | `/api/v1/health/ready`                            | No                        | PostgreSQL, Discord, and scheduler readiness                    |

## Pagination

Notification history supports `cursor` and `limit` query parameters. `limit` defaults to `20` and accepts values from `1` through `100`. Pass `page.nextCursor` to the next request until `page.hasMore` is false.

Manageable guilds include `membershipState` and `trackedStreamerCount`. A dashboard should consider the bot connected only when `membershipState` is `CONNECTED`. Presence messages accept `usePlaceholders`; `{guilds}` and `{streamers}` are expanded only when that flag is enabled.

Instant search accepts `query` (2–80 characters) and `limit` (1–25). Queue creation accepts `{ "voiceChannelId": "...", "instantUrl": "https://www.myinstants.com/en/instant/.../" }`; arbitrary audio URLs are never accepted or returned. Queues are FIFO and process-local, so they are cleared on restart. `EVERYONE` and `ALLOWLIST_ONLY` are bot-wide modes, global admins bypass the user allowlist, and guild managers retain stop/clear moderation access.

Music queue creation accepts `{ "voiceChannelId": "...", "sourceUrl": "https://..." }`. Only exact HTTPS YouTube, YouTube Music, youtu.be, and Spotify track/playlist hosts are accepted. A YouTube watch URL containing a playlist queues only its selected video; only `/playlist` URLs expand. Spotify provides metadata and attribution, then the backend chooses a duration- and title-matched YouTube source. Responses never include temporary media URLs or subprocess arguments. Music is process-local, limited to 25 imported playlist items, and shares the Instants enable switch and allowed-user list.

## Development examples

```bash
curl http://localhost:4000/api/v1/health/live
curl http://localhost:4000/api/docs-json
```

For browser-based authenticated requests:

```ts
const response = await fetch("/api/v1/guilds", {
  credentials: "include"
});
```

Swagger's **Authorize** dialog accepts the raw encrypted session-cookie value. For normal use, authenticate through the Discord OAuth endpoint instead.

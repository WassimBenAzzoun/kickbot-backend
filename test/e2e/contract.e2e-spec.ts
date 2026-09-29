import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DiscordApiService } from "../../src/auth/discord-api.service.js";
import { SessionService } from "../../src/auth/session.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";

const now = new Date("2026-09-29T10:00:00.000Z");
const guild = {
  id: "123456789012345678",
  name: "Creators",
  iconHash: null,
  membershipState: "CONNECTED" as const,
  alertChannelId: "223456789012345678",
  isAllowed: true,
  allowlistNotes: null,
  allowedByDiscordUserId: null,
  allowedAt: null,
  joinedAt: now,
  leftAt: null,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now
};

describe("Dashboard API contract", () => {
  let app: NestFastifyApplication;
  let cookie: string;
  const prisma = {
    globalAdmin: { findUnique: vi.fn(async () => ({ discordId: "923456789012345678" })) },
    discordGuild: {
      findMany: vi.fn(async () => [{ ...guild, _count: { streamers: 3 } }]),
      upsert: vi.fn(async ({ create, update }: { create: object; update: object }) => ({
        ...guild,
        ...create,
        ...update
      })),
      update: vi.fn(async ({ data }: { data: object }) => ({ ...guild, ...data }))
    },
    notification: {
      findMany: vi.fn(async () =>
        ["346abf54-9bdf-42ec-8f76-3ac0fc0df932", "346abf54-9bdf-42ec-8f76-3ac0fc0df931"].map(
          (id, index) => ({
            id,
            guildId: guild.id,
            streamerId: null,
            streamerUsername: "Creator",
            normalizedUsername: "creator",
            platform: "KICK",
            status: "LIVE",
            streamUrl: "https://kick.com/creator",
            title: "Live",
            category: "Games",
            thumbnailUrl: null,
            viewerCount: 10,
            streamStartedAt: new Date(now.getTime() - index * 1000),
            discordMessageId: "323456789012345678",
            sentAt: new Date(now.getTime() - index * 1000)
          })
        )
      )
    },
    presenceMessage: {
      aggregate: vi.fn(async () => ({ _max: { sortOrder: null } })),
      create: vi.fn(async ({ data }: { data: object }) => ({
        id: "346abf54-9bdf-42ec-8f76-3ac0fc0df931",
        enabled: true,
        usePlaceholders: true,
        ...data,
        createdAt: now,
        updatedAt: now
      }))
    }
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      DISCORD_ENABLED: "false",
      DISCORD_CLIENT_ID: "123456789012345678",
      DISCORD_CLIENT_SECRET: "test-secret",
      DISCORD_REDIRECT_URI: "http://localhost:3000/api/v1/auth/discord/callback",
      GLOBAL_ADMIN_DISCORD_IDS: "",
      KICK_CLIENT_ID: "test-client",
      KICK_CLIENT_SECRET: "test-secret",
      SESSION_ENCRYPTION_KEY: "test-encryption-key-with-at-least-32-characters"
    });
    const { AppModule } = await import("../../src/app.module.js");
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(DiscordApiService)
      .useValue({
        userGuilds: vi.fn(async () => [
          { id: guild.id, name: guild.name, icon: null, permissions: "32" }
        ]),
        guildChannels: vi.fn(async () => [{ id: "223456789012345678", name: "alerts", type: 0 }])
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const token = await app.get(SessionService).createSession({
      id: "923456789012345678",
      username: "tester",
      globalName: "Test User",
      avatar: "avatar-hash",
      accessToken: "oauth-token"
    });
    cookie = `kickbot_session=${token}`;
  });

  afterAll(async () => app.close());

  it("returns the enriched authenticated user and manageable guild", async () => {
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie }
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      id: "923456789012345678",
      username: "tester",
      globalName: "Test User",
      avatarUrl: "https://cdn.discordapp.com/avatars/923456789012345678/avatar-hash.png?size=128",
      isGlobalAdmin: true
    });

    const guilds = await app.inject({
      method: "GET",
      url: "/api/v1/guilds",
      headers: { cookie }
    });
    expect(guilds.statusCode).toBe(200);
    expect(guilds.json().items[0]).toMatchObject({
      id: guild.id,
      membershipState: "CONNECTED",
      trackedStreamerCount: 3
    });
  });

  it("uses direct entities, access updates, placeholders, and cursor pagination", async () => {
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/guilds/${guild.id}`,
      headers: { cookie },
      payload: { alertChannelId: guild.alertChannelId }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: guild.id, alertChannelId: guild.alertChannelId });
    expect(updated.json()).not.toHaveProperty("config");

    const notifications = await app.inject({
      method: "GET",
      url: `/api/v1/guilds/${guild.id}/notifications?limit=1`,
      headers: { cookie }
    });
    expect(notifications.statusCode).toBe(200);
    expect(notifications.json()).toMatchObject({
      items: [{ id: "346abf54-9bdf-42ec-8f76-3ac0fc0df932" }],
      page: { hasMore: true }
    });
    expect(notifications.json().page.nextCursor).toEqual(expect.any(String));

    const access = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/guilds/${guild.id}/access`,
      headers: { cookie },
      payload: { isAllowed: false, notes: "paused" }
    });
    expect(access.statusCode).toBe(200);
    expect(access.json()).toMatchObject({
      id: guild.id,
      isAllowed: false,
      allowlistNotes: "paused"
    });

    const presence = await app.inject({
      method: "POST",
      url: "/api/v1/admin/presence-messages",
      headers: { cookie },
      payload: {
        text: "Watching {guilds}",
        activityType: "WATCHING",
        usePlaceholders: false
      }
    });
    expect(presence.statusCode).toBe(201);
    expect(presence.json()).toMatchObject({ usePlaceholders: false });
  });
});

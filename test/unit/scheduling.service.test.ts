import type { ConfigService } from "@nestjs/config";
import type { SchedulerRegistry } from "@nestjs/schedule";
import { describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { DiscordService } from "../../src/discord/discord/discord.service.js";
import type { KickService, StreamStatus } from "../../src/kick/kick/kick.service.js";
import { SchedulingService } from "../../src/scheduling/scheduling/scheduling.service.js";

describe("SchedulingService", () => {
  it("reserves a live instance before sending and retries an incomplete delivery once", async () => {
    const startedAt = new Date("2026-09-25T20:00:00.000Z");
    const streamer = {
      id: "streamer-1",
      guildId: "123",
      platform: "KICK" as const,
      username: "Creator",
      normalizedUsername: "creator",
      enabled: true,
      lastKnownLiveState: false,
      currentLiveStartedAt: null as Date | null,
      lastNotifiedLiveAt: null as Date | null,
      guild: { alertChannelId: "456" }
    };
    let reservation:
      | {
          id: string;
          sentAt: Date | null;
          discordMessageId: string | null;
        }
      | undefined;

    const prisma = {
      trackedStreamer: {
        findMany: vi.fn(async () => [{ ...streamer, guild: { ...streamer.guild } }]),
        update: vi.fn(async ({ data }: { data: Partial<typeof streamer> }) => {
          Object.assign(streamer, data);
          return streamer;
        }),
        count: vi.fn()
      },
      notification: {
        findUnique: vi.fn(async () => reservation),
        upsert: vi.fn(async () => {
          reservation ??= { id: "notification-1", sentAt: null, discordMessageId: null };
          return reservation;
        }),
        update: vi.fn(async ({ data }: { data: { sentAt: Date; discordMessageId: string } }) => {
          Object.assign(reservation!, data);
          return reservation;
        })
      },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations))
    };
    const status: StreamStatus = {
      isLive: true,
      username: "Creator",
      normalizedUsername: "creator",
      streamUrl: "https://kick.com/creator",
      title: "Live",
      category: "Games",
      thumbnailUrl: null,
      profileImageUrl: null,
      viewerCount: 10,
      startedAt
    };
    const kick = { getStatus: vi.fn(async () => status) };
    const sendLiveNotification = vi
      .fn<DiscordService["sendLiveNotification"]>()
      .mockRejectedValueOnce(new Error("Discord unavailable"))
      .mockResolvedValue("message-1");
    const discord = { sendLiveNotification };
    const config = {
      get: vi.fn((key: keyof Environment) => {
        if (key === "PROVIDER_MAX_CONCURRENCY") return 1;
        throw new Error(`Unexpected config key: ${key}`);
      })
    };
    const service = new SchedulingService(
      {} as SchedulerRegistry,
      config as unknown as ConfigService<Environment, true>,
      prisma as unknown as PrismaService,
      kick as unknown as KickService,
      discord as unknown as DiscordService
    );

    await service.poll();
    expect(reservation).toMatchObject({ sentAt: null, discordMessageId: null });
    expect(sendLiveNotification).toHaveBeenCalledTimes(1);

    await service.poll();
    expect(reservation?.sentAt).toBeInstanceOf(Date);
    expect(reservation?.discordMessageId).toBe("message-1");
    expect(sendLiveNotification).toHaveBeenCalledTimes(2);

    await service.poll();
    expect(sendLiveNotification).toHaveBeenCalledTimes(2);
    expect(prisma.notification.upsert).toHaveBeenCalledTimes(1);
  });

  it("skips an overlapping poll cycle", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prisma = {
      trackedStreamer: {
        findMany: vi.fn(async () => {
          await waiting;
          return [];
        })
      }
    };
    const config = { get: vi.fn(() => 1) };
    const service = new SchedulingService(
      {} as SchedulerRegistry,
      config as unknown as ConfigService<Environment, true>,
      prisma as unknown as PrismaService,
      {} as KickService,
      {} as DiscordService
    );

    const first = service.poll();
    await service.poll();
    expect(prisma.trackedStreamer.findMany).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it("expands presence placeholders only when the message enables them", async () => {
    const message = {
      text: "Watching {guilds} guilds and {streamers} streamers",
      activityType: "WATCHING" as const,
      usePlaceholders: false
    };
    const prisma = {
      botSettings: {
        upsert: vi.fn(async () => ({ rotationEnabled: true }))
      },
      presenceMessage: {
        findMany: vi.fn(async () => [message])
      },
      discordGuild: { count: vi.fn(async () => 4) },
      trackedStreamer: { count: vi.fn(async () => 9) }
    };
    const discord = { isReady: vi.fn(() => true), setPresence: vi.fn() };
    const service = new SchedulingService(
      {} as SchedulerRegistry,
      {} as ConfigService<Environment, true>,
      prisma as unknown as PrismaService,
      {} as KickService,
      discord as unknown as DiscordService
    );

    await service.rotatePresence();
    expect(discord.setPresence).toHaveBeenLastCalledWith(message.text, "WATCHING");
    expect(prisma.discordGuild.count).not.toHaveBeenCalled();

    message.usePlaceholders = true;
    await service.rotatePresence();
    expect(discord.setPresence).toHaveBeenLastCalledWith(
      "Watching 4 guilds and 9 streamers",
      "WATCHING"
    );
  });
});

import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import type { Environment } from "../../config/environment.js";
import { PrismaService } from "../../database/prisma.service.js";
import { NotificationStatus } from "../../generated/prisma/enums.js";
import { DiscordService } from "../../discord/discord/discord.service.js";
import { KickService, type StreamStatus } from "../../kick/kick/kick.service.js";

@Injectable()
export class SchedulingService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulingService.name);
  private polling = false;
  private presenceIndex = 0;
  private initialized = false;

  public constructor(
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<Environment, true>,
    private readonly prisma: PrismaService,
    private readonly kick: KickService,
    private readonly discord: DiscordService
  ) {}

  public onApplicationBootstrap(): void {
    this.addInterval(
      "kick-live-poll",
      this.config.get("POLL_INTERVAL_SECONDS", { infer: true }) * 1000,
      () => this.poll()
    );
    this.addInterval(
      "discord-presence",
      this.config.get("BOT_PRESENCE_SYNC_INTERVAL_SECONDS", { infer: true }) * 1000,
      () => this.rotatePresence()
    );
    void this.poll();
    void this.rotatePresence();
    this.initialized = true;
  }

  public onApplicationShutdown(): void {
    this.initialized = false;
    for (const name of ["kick-live-poll", "discord-presence"]) {
      try {
        clearInterval(this.registry.getInterval(name));
        this.registry.deleteInterval(name);
      } catch {
        // The interval may not have been registered if startup failed early.
      }
    }
  }

  public isReady(): boolean {
    return this.initialized;
  }

  public async poll(): Promise<void> {
    if (this.polling) {
      this.logger.warn("Skipping overlapping Kick polling cycle");
      return;
    }
    this.polling = true;
    try {
      const subscriptions = await this.prisma.trackedStreamer.findMany({
        where: { enabled: true },
        include: { guild: true }
      });
      const groups = new Map<string, typeof subscriptions>();
      for (const subscription of subscriptions) {
        const list = groups.get(subscription.normalizedUsername) ?? [];
        list.push(subscription);
        groups.set(subscription.normalizedUsername, list);
      }
      await mapWithConcurrency(
        [...groups.entries()],
        this.config.get("PROVIDER_MAX_CONCURRENCY", { infer: true }),
        async ([username, tracked]) => {
          const status = await this.kick.getStatus(username);
          await Promise.all(tracked.map((streamer) => this.processSubscription(streamer, status)));
        }
      );
    } catch (error) {
      this.logger.error({ error }, "Kick polling cycle failed");
    } finally {
      this.polling = false;
    }
  }

  public async rotatePresence(): Promise<void> {
    if (!this.discord.isReady()) return;
    const settings = await this.prisma.botSettings.upsert({
      where: { id: "default" },
      create: {},
      update: {}
    });
    if (!settings.rotationEnabled) {
      this.discord.setPresence(
        settings.defaultStatusEnabled ? settings.defaultStatusText : null,
        settings.defaultActivityType
      );
      return;
    }
    const messages = await this.prisma.presenceMessage.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    if (messages.length === 0) {
      this.discord.setPresence(
        settings.defaultStatusEnabled ? settings.defaultStatusText : null,
        settings.defaultActivityType
      );
      return;
    }
    const message = messages[this.presenceIndex % messages.length]!;
    this.presenceIndex += 1;
    const [guildCount, streamerCount] = message.usePlaceholders
      ? await Promise.all([
          this.prisma.discordGuild.count({ where: { membershipState: "CONNECTED" } }),
          this.prisma.trackedStreamer.count({ where: { enabled: true } })
        ])
      : [0, 0];
    this.discord.setPresence(
      message.usePlaceholders
        ? message.text
            .replaceAll("{guilds}", guildCount.toString())
            .replaceAll("{streamers}", streamerCount.toString())
        : message.text,
      message.activityType
    );
  }

  private async processSubscription(
    streamer: {
      id: string;
      guildId: string;
      platform: "KICK";
      normalizedUsername: string;
      lastKnownLiveState: boolean;
      currentLiveStartedAt: Date | null;
      guild: { alertChannelId: string | null };
    },
    status: StreamStatus
  ): Promise<void> {
    try {
      if (!status.isLive) {
        if (streamer.lastKnownLiveState) {
          await this.prisma.trackedStreamer.update({
            where: { id: streamer.id },
            data: { lastKnownLiveState: false, currentLiveStartedAt: null }
          });
        }
        return;
      }
      const streamStartedAt = status.startedAt ?? streamer.currentLiveStartedAt ?? new Date();
      const sameInstance =
        streamer.lastKnownLiveState &&
        streamer.currentLiveStartedAt?.getTime() === streamStartedAt.getTime();
      await this.prisma.trackedStreamer.update({
        where: { id: streamer.id },
        data: { lastKnownLiveState: true, currentLiveStartedAt: streamStartedAt }
      });
      if (!streamer.guild.alertChannelId) return;
      const notificationKey = {
        guildId: streamer.guildId,
        platform: streamer.platform,
        normalizedUsername: streamer.normalizedUsername,
        streamStartedAt
      };
      const existing = await this.prisma.notification.findUnique({
        where: {
          guildId_platform_normalizedUsername_streamStartedAt: notificationKey
        }
      });
      if (existing?.sentAt || (sameInstance && !existing)) return;

      const reservation =
        existing ??
        (await this.prisma.notification.upsert({
          where: { guildId_platform_normalizedUsername_streamStartedAt: notificationKey },
          update: {},
          create: {
            ...notificationKey,
            streamerId: streamer.id,
            streamerUsername: status.username,
            status: NotificationStatus.LIVE,
            streamUrl: status.streamUrl,
            title: status.title,
            category: status.category,
            thumbnailUrl: status.thumbnailUrl,
            viewerCount: status.viewerCount
          }
        }));
      if (reservation.sentAt) return;

      const messageId = await this.discord.sendLiveNotification(
        streamer.guildId,
        streamer.guild.alertChannelId,
        status
      );
      await this.prisma.$transaction([
        this.prisma.notification.update({
          where: { id: reservation.id },
          data: { discordMessageId: messageId, sentAt: new Date() }
        }),
        this.prisma.trackedStreamer.update({
          where: { id: streamer.id },
          data: { lastNotifiedLiveAt: new Date() }
        })
      ]);
    } catch (error) {
      this.logger.error(
        { error, guildId: streamer.guildId, streamer: streamer.normalizedUsername },
        "Failed to process live subscription"
      );
    }
  }

  private addInterval(name: string, milliseconds: number, callback: () => Promise<void>): void {
    const interval = setInterval(() => void callback(), milliseconds);
    this.registry.addInterval(name, interval);
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  operation: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) await operation(queue.shift()!);
    })
  );
}

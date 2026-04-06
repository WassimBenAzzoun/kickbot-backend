import { NotificationStatus, TrackedStreamer } from "@prisma/client";
import { Logger } from "pino";
import { GuildConfigRepository } from "../repositories/guildConfigRepository";
import { NotificationHistoryRepository } from "../repositories/notificationHistoryRepository";
import { TrackedStreamerRepository } from "../repositories/trackedStreamerRepository";
import { DiscordNotificationService } from "../services/discordNotificationService";
import { ProviderRegistry } from "../services/providers/providerRegistry";
import { mapWithConcurrency } from "../utils/async";

interface LiveStatusPollingJobOptions {
  pollIntervalSeconds: number;
  maxConcurrency: number;
}

interface LiveStatusPollingJobDependencies {
  trackedStreamerRepository: TrackedStreamerRepository;
  guildConfigRepository: GuildConfigRepository;
  notificationHistoryRepository: NotificationHistoryRepository;
  notificationService: DiscordNotificationService;
  providerRegistry: ProviderRegistry;
  logger: Logger;
}

export class LiveStatusPollingJob {
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  public constructor(
    private readonly options: LiveStatusPollingJobOptions,
    private readonly deps: LiveStatusPollingJobDependencies
  ) {
    this.pollIntervalMs = options.pollIntervalSeconds * 1000;
  }

  public start(): void {
    if (this.timer) {
      return;
    }

    this.deps.logger.info(
      {
        pollIntervalSeconds: this.options.pollIntervalSeconds,
        maxConcurrency: this.options.maxConcurrency
      },
      "Starting live status polling job"
    );

    void this.runCycle();

    this.timer = setInterval(() => {
      void this.runCycle();
    }, this.pollIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runCycle(): Promise<void> {
    if (this.isRunning) {
      this.deps.logger.warn("Polling cycle skipped because previous cycle is still running");
      return;
    }

    this.isRunning = true;
    const startedAt = Date.now();

    try {
      const activeStreamers = await this.deps.trackedStreamerRepository.listAllActive();
      const guildIds = [...new Set(activeStreamers.map((streamer) => streamer.guildId))];
      const guildConfigs = await this.deps.guildConfigRepository.findManyByGuildIds(guildIds);
      const guildConfigMap = new Map(guildConfigs.map((config) => [config.guildId, config]));

      this.deps.logger.info(
        {
          guildCount: guildIds.length,
          activeStreamerCount: activeStreamers.length
        },
        "Polling cycle started"
      );

      await mapWithConcurrency(activeStreamers, this.options.maxConcurrency, async (streamer) => {
        const guildConfig = guildConfigMap.get(streamer.guildId) ?? null;
        await this.processStreamer(streamer, guildConfig?.alertChannelId ?? null);
      });

      this.deps.logger.info(
        {
          durationMs: Date.now() - startedAt,
          guildCount: guildIds.length,
          activeStreamerCount: activeStreamers.length
        },
        "Polling cycle completed"
      );
    } catch (error) {
      this.deps.logger.error({ err: error }, "Polling cycle failed");
    } finally {
      this.isRunning = false;
    }
  }

  private async processStreamer(
    trackedStreamer: TrackedStreamer,
    alertChannelId: string | null
  ): Promise<void> {
    const provider = this.deps.providerRegistry.getProvider(trackedStreamer.platform);

    try {
      const status = await provider.getStreamStatus(trackedStreamer.streamerUsername);

      if (status.isLive) {
        if (!trackedStreamer.lastKnownLiveState) {
          const transitioned = await this.deps.trackedStreamerRepository.markLiveTransition(
            trackedStreamer.id
          );

          if (!transitioned) {
            return;
          }

          if (!alertChannelId) {
            this.deps.logger.warn(
              {
                guildId: trackedStreamer.guildId,
                streamerUsername: trackedStreamer.streamerUsername
              },
              "Streamer went live but alert channel is not configured"
            );
            return;
          }

          const messageId = await this.deps.notificationService.sendLiveNotification(
            trackedStreamer.guildId,
            alertChannelId,
            status
          );

          if (messageId) {
            await this.deps.notificationHistoryRepository.createNotification({
              guildId: trackedStreamer.guildId,
              streamerUsername: trackedStreamer.streamerUsername,
              platform: trackedStreamer.platform,
              status: NotificationStatus.LIVE,
              messageId
            });
          }
        }

        return;
      }

      if (trackedStreamer.lastKnownLiveState) {
        await this.deps.trackedStreamerRepository.markOfflineTransition(trackedStreamer.id);
      }
    } catch (error) {
      this.deps.logger.error(
        {
          err: error,
          guildId: trackedStreamer.guildId,
          streamerUsername: trackedStreamer.streamerUsername,
          platform: trackedStreamer.platform
        },
        "Failed to process tracked streamer"
      );
    }
  }
}
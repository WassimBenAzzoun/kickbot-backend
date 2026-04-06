import { ActivityType, Client, PresenceStatusData } from "discord.js";
import { BotActivityType, BotStatusMessage, GlobalBotConfig } from "@prisma/client";
import { Logger } from "pino";
import { env } from "../config/env";
import { TrackedStreamerRepository } from "../repositories/trackedStreamerRepository";
import { BotStatusMessageService } from "./botStatusMessageService";
import { GlobalBotConfigService } from "./globalBotConfigService";

interface PresenceTemplate {
  text: string;
  activityType: BotActivityType;
  usePlaceholders: boolean;
  key: string;
}

interface PresenceRendered {
  text: string;
  activityType: BotActivityType;
}

const FALLBACK_STATUS_TEMPLATE: PresenceTemplate = {
  text: "Monitoring Kick live alerts",
  activityType: BotActivityType.WATCHING,
  usePlaceholders: true,
  key: "fallback"
};

export class BotPresenceManager {
  private timer: NodeJS.Timeout | null = null;
  private isTickRunning = false;
  private needsReload = true;
  private rotationIndex = 0;
  private nextRotationAtMs = 0;
  private lastConfigSignature: string | null = null;
  private lastAppliedPresenceKey: string | null = null;

  public constructor(
    private readonly client: Client,
    private readonly globalBotConfigService: GlobalBotConfigService,
    private readonly botStatusMessageService: BotStatusMessageService,
    private readonly trackedStreamerRepository: TrackedStreamerRepository,
    private readonly logger: Logger
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }

    this.logger.info(
      { syncIntervalSeconds: env.BOT_PRESENCE_SYNC_INTERVAL_SECONDS },
      "Starting bot presence manager"
    );

    this.needsReload = true;
    void this.tick();

    this.timer = setInterval(() => {
      void this.tick();
    }, env.BOT_PRESENCE_SYNC_INTERVAL_SECONDS * 1000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public reload(): void {
    this.needsReload = true;
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.isTickRunning) {
      return;
    }

    this.isTickRunning = true;

    try {
      const [config, enabledMessages] = await Promise.all([
        this.globalBotConfigService.getGlobalConfig(),
        this.botStatusMessageService.listEnabled()
      ]);

      const signature = this.buildSignature(config, enabledMessages);
      if (signature !== this.lastConfigSignature) {
        this.lastConfigSignature = signature;
        this.rotationIndex = 0;
        this.nextRotationAtMs = 0;
        this.needsReload = true;
      }

      const now = Date.now();
      const shouldApplyBySchedule = config.rotationEnabled ? now >= this.nextRotationAtMs : true;

      if (!this.needsReload && !shouldApplyBySchedule) {
        return;
      }

      const selectedTemplate = this.selectTemplate(config, enabledMessages);
      const rendered = await this.renderTemplate(selectedTemplate);
      await this.applyStatus(rendered, selectedTemplate.key);

      this.needsReload = false;

      if (config.rotationEnabled && enabledMessages.length > 0) {
        this.rotationIndex = (this.rotationIndex + 1) % enabledMessages.length;
        this.nextRotationAtMs = Date.now() + config.rotationIntervalSeconds * 1000;
      } else {
        this.nextRotationAtMs = 0;
      }
    } catch (error) {
      this.logger.error({ err: error }, "Bot presence manager tick failed");
    } finally {
      this.isTickRunning = false;
    }
  }

  private selectTemplate(config: GlobalBotConfig, enabledMessages: BotStatusMessage[]): PresenceTemplate {
    if (config.rotationEnabled && enabledMessages.length > 0) {
      const index = this.rotationIndex % enabledMessages.length;
      const message = enabledMessages[index];

      return {
        text: message.text,
        activityType: message.activityType,
        usePlaceholders: message.usePlaceholders,
        key: `rotation:${message.id}:${message.updatedAt.toISOString()}`
      };
    }

    if (config.defaultStatusEnabled && config.defaultStatusText && config.defaultActivityType) {
      return {
        text: config.defaultStatusText,
        activityType: config.defaultActivityType,
        usePlaceholders: true,
        key: `default:${config.updatedAt.toISOString()}`
      };
    }

    return FALLBACK_STATUS_TEMPLATE;
  }

  private async renderTemplate(template: PresenceTemplate): Promise<PresenceRendered> {
    const templateText = template.text.trim();
    if (!templateText) {
      return {
        text: FALLBACK_STATUS_TEMPLATE.text,
        activityType: FALLBACK_STATUS_TEMPLATE.activityType
      };
    }

    if (!template.usePlaceholders) {
      return {
        text: this.clampPresenceText(templateText),
        activityType: template.activityType
      };
    }

    const [trackedStreamerCount, liveStreamerCount] = await Promise.all([
      this.trackedStreamerRepository.countAll(),
      this.trackedStreamerRepository.countActiveLive()
    ]);

    const guildCount = this.client.guilds.cache.size;
    const userCount = this.client.guilds.cache.reduce(
      (sum, guild) => sum + (guild.memberCount ?? 0),
      0
    );
    const botName = this.client.user?.username ?? "Kick Bot";

    const renderedText = this.renderPlaceholderText(templateText, {
      guildCount,
      trackedStreamerCount,
      liveStreamerCount,
      userCount,
      botName
    });

    return {
      text: this.clampPresenceText(renderedText),
      activityType: template.activityType
    };
  }

  private renderPlaceholderText(
    text: string,
    values: {
      guildCount: number;
      trackedStreamerCount: number;
      liveStreamerCount: number;
      userCount: number;
      botName: string;
    }
  ): string {
    return text.replace(/\{(guildCount|trackedStreamerCount|liveStreamerCount|userCount|botName)\}/g, (match, key) => {
      switch (key) {
        case "guildCount":
          return String(values.guildCount);
        case "trackedStreamerCount":
          return String(values.trackedStreamerCount);
        case "liveStreamerCount":
          return String(values.liveStreamerCount);
        case "userCount":
          return String(values.userCount);
        case "botName":
          return values.botName;
        default:
          return match;
      }
    });
  }

  private clampPresenceText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
      return FALLBACK_STATUS_TEMPLATE.text;
    }

    if (trimmed.length <= 128) {
      return trimmed;
    }

    return `${trimmed.slice(0, 125)}...`;
  }

  private async applyStatus(rendered: PresenceRendered, templateKey: string): Promise<void> {
    const presenceKey = `${templateKey}|${rendered.activityType}|${rendered.text}`;
    if (presenceKey === this.lastAppliedPresenceKey) {
      return;
    }

    const presencePayload = this.toDiscordPresence(rendered);
    if (!presencePayload) {
      this.logger.warn({ activityType: rendered.activityType }, "Skipping invalid presence payload");
      return;
    }

    this.client.user?.setPresence({
      activities: [presencePayload.activity],
      status: presencePayload.status
    });

    this.lastAppliedPresenceKey = presenceKey;

    this.logger.info(
      {
        activityType: rendered.activityType,
        text: rendered.text
      },
      "Updated bot presence status"
    );
  }

  private toDiscordPresence(rendered: PresenceRendered): {
    activity: { type: ActivityType; name: string; state?: string };
    status: PresenceStatusData;
  } | null {
    switch (rendered.activityType) {
      case BotActivityType.PLAYING:
        return {
          activity: {
            type: ActivityType.Playing,
            name: rendered.text
          },
          status: "online"
        };
      case BotActivityType.WATCHING:
        return {
          activity: {
            type: ActivityType.Watching,
            name: rendered.text
          },
          status: "online"
        };
      case BotActivityType.LISTENING:
        return {
          activity: {
            type: ActivityType.Listening,
            name: rendered.text
          },
          status: "online"
        };
      case BotActivityType.COMPETING:
        return {
          activity: {
            type: ActivityType.Competing,
            name: rendered.text
          },
          status: "online"
        };
      case BotActivityType.CUSTOM:
        return {
          activity: {
            type: ActivityType.Custom,
            name: "Custom Status",
            state: rendered.text
          },
          status: "online"
        };
      default:
        return null;
    }
  }

  private buildSignature(config: GlobalBotConfig, enabledMessages: BotStatusMessage[]): string {
    const messageSignature = enabledMessages
      .map((message) => `${message.id}:${message.updatedAt.getTime()}:${message.sortOrder}:${message.isEnabled}`)
      .join("|");

    return [
      config.rotationEnabled,
      config.rotationIntervalSeconds,
      config.defaultStatusEnabled,
      config.defaultStatusText ?? "",
      config.defaultActivityType ?? "",
      config.updatedAt.getTime(),
      messageSignature
    ].join(";");
  }
}

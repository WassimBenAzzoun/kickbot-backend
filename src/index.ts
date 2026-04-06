import { commandCollection } from "./commands";
import { createDiscordClient } from "./bot/createClient";
import { prisma } from "./config/database";
import { env } from "./config/env";
import { requireEnvValue } from "./config/required";
import { registerGuildStateEvents } from "./events/registerGuildStateEvents";
import { registerGuildWhitelistEvents } from "./events/registerGuildWhitelistEvents";
import { registerInteractionCreateEvent } from "./events/registerInteractionCreateEvent";
import { registerReadyEvent } from "./events/registerReadyEvent";
import { LiveStatusPollingJob } from "./jobs/liveStatusPollingJob";
import { BotPresenceManager } from "./services/botPresenceManager";
import { DiscordNotificationService } from "./services/discordNotificationService";
import { GuildWhitelistEnforcementService } from "./services/guildWhitelistEnforcementService";
import { GuildConfigService } from "./services/guildConfigService";
import { KickProvider } from "./services/providers/kickProvider";
import { ProviderRegistry } from "./services/providers/providerRegistry";
import { TrackedStreamerService } from "./services/trackedStreamerService";
import { createAppContext } from "./shared/appContext";
import { logger } from "./utils/logger";

async function bootstrap(): Promise<void> {
  const appLogger = logger.child({ scope: "bot" });
  const discordToken = requireEnvValue(env.DISCORD_TOKEN, "DISCORD_TOKEN");

  const appContext = createAppContext();

  const guildConfigService = appContext.guildConfigService as GuildConfigService;
  const trackedStreamerService = appContext.trackedStreamerService as TrackedStreamerService;

  const client = createDiscordClient();
  const notificationService = new DiscordNotificationService(
    client,
    logger.child({ scope: "notification" })
  );

  const providerRegistry = new ProviderRegistry([
    new KickProvider(logger.child({ scope: "kick-provider" }))
  ]);

  const pollJob = new LiveStatusPollingJob(
    {
      pollIntervalSeconds: env.POLL_INTERVAL_SECONDS,
      maxConcurrency: env.PROVIDER_MAX_CONCURRENCY
    },
    {
      trackedStreamerRepository: appContext.trackedStreamerRepository,
      guildConfigRepository: appContext.guildConfigRepository,
      notificationHistoryRepository: appContext.notificationHistoryRepository,
      notificationService,
      providerRegistry,
      logger: logger.child({ scope: "polling" })
    }
  );

  const presenceManager = new BotPresenceManager(
    client,
    appContext.globalBotConfigService,
    appContext.botStatusMessageService,
    appContext.trackedStreamerRepository,
    logger.child({ scope: "presence" })
  );

  const guildWhitelistEnforcementService = new GuildWhitelistEnforcementService(
    appContext.guildWhitelistSettingsService,
    appContext.whitelistedGuildService,
    appContext.botGuildStateService,
    logger.child({ scope: "guild-whitelist" })
  );

  registerReadyEvent(
    client,
    pollJob,
    presenceManager,
    appContext.botGuildStateService,
    guildWhitelistEnforcementService,
    logger.child({ scope: "discord-ready" })
  );

  registerGuildStateEvents(
    client,
    appContext.botGuildStateService,
    logger.child({ scope: "guild-state" })
  );

  registerGuildWhitelistEvents(
    client,
    guildWhitelistEnforcementService,
    logger.child({ scope: "guild-whitelist-events" })
  );

  registerInteractionCreateEvent(
    client,
    commandCollection,
    {
      guildConfigService,
      trackedStreamerService
    },
    logger.child({ scope: "discord-commands" })
  );

  const shutdown = async (signal: string): Promise<void> => {
    appLogger.info({ signal }, "Shutting down Kick Discord notifier bot");
    pollJob.stop();
    presenceManager.stop();
    client.destroy();
    await prisma.$disconnect();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });

  process.on("unhandledRejection", (reason) => {
    appLogger.error({ err: reason }, "Unhandled bot promise rejection");
  });

  process.on("uncaughtException", (error) => {
    appLogger.fatal({ err: error }, "Uncaught bot exception");
    void shutdown("uncaughtException").finally(() => process.exit(1));
  });

  await client.login(discordToken);
}

void bootstrap().catch(async (error) => {
  logger.fatal({ err: error }, "Failed to bootstrap bot");
  await prisma.$disconnect();
  process.exit(1);
});

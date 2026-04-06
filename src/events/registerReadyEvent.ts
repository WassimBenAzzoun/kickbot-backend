import { Client, Events } from "discord.js";
import { Logger } from "pino";
import { LiveStatusPollingJob } from "../jobs/liveStatusPollingJob";
import { BotGuildStateService } from "../services/botGuildStateService";
import { GuildWhitelistEnforcementService } from "../services/guildWhitelistEnforcementService";
import { BotPresenceManager } from "../services/botPresenceManager";

export function registerReadyEvent(
  client: Client,
  pollJob: LiveStatusPollingJob,
  presenceManager: BotPresenceManager,
  botGuildStateService: BotGuildStateService,
  guildWhitelistEnforcementService: GuildWhitelistEnforcementService,
  logger: Logger
): void {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info({ botUserTag: readyClient.user.tag }, "Discord client is ready");

    let backgroundServicesStarted = false;

    const startBackgroundServices = () => {
      if (backgroundServicesStarted) {
        return;
      }

      backgroundServicesStarted = true;
      pollJob.start();
      presenceManager.start();
    };

    void (async () => {
      try {
        const guildSnapshots = readyClient.guilds.cache.map((guild) => ({
          guildId: guild.id,
          guildName: guild.name,
          iconHash: guild.icon
        }));

        await botGuildStateService.syncGuildSnapshots(guildSnapshots);
        await guildWhitelistEnforcementService.reconcileCurrentGuilds(readyClient);
      } catch (error) {
        logger.error({ err: error }, "Failed to complete startup guild reconciliation");
      } finally {
        startBackgroundServices();
      }
    })();
  });
}

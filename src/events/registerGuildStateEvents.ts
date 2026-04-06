import { Client, Events, Guild } from "discord.js";
import { Logger } from "pino";
import { BotGuildStateService } from "../services/botGuildStateService";

function toSnapshot(guild: Guild): { guildId: string; guildName: string; iconHash: string | null } {
  return {
    guildId: guild.id,
    guildName: guild.name,
    iconHash: guild.icon
  };
}

export function registerGuildStateEvents(
  client: Client,
  botGuildStateService: BotGuildStateService,
  logger: Logger
): void {
  client.on(Events.GuildCreate, (guild) => {
    void botGuildStateService
      .markGuildJoined(toSnapshot(guild))
      .then(() => {
        logger.info({ guildId: guild.id, guildName: guild.name }, "Recorded bot guild join");
      })
      .catch((error) => {
        logger.error({ err: error, guildId: guild.id }, "Failed to record bot guild join");
      });
  });

  client.on(Events.GuildDelete, (guild) => {
    void botGuildStateService
      .markGuildLeft(guild.id)
      .then(() => {
        logger.info({ guildId: guild.id, guildName: guild.name }, "Recorded bot guild leave");
      })
      .catch((error) => {
        logger.error({ err: error, guildId: guild.id }, "Failed to record bot guild leave");
      });
  });
}

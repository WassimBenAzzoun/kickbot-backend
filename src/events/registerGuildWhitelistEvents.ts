import { Client, Events } from "discord.js";
import { Logger } from "pino";
import { GuildWhitelistEnforcementService } from "../services/guildWhitelistEnforcementService";

export function registerGuildWhitelistEvents(
  client: Client,
  guildWhitelistEnforcementService: GuildWhitelistEnforcementService,
  logger: Logger
): void {
  client.on(Events.GuildCreate, (guild) => {
    void guildWhitelistEnforcementService.handleGuildJoin(guild).catch((error) => {
      logger.error(
        {
          err: error,
          guildId: guild.id,
          guildName: guild.name
        },
        "Failed to enforce guild whitelist on guild join"
      );
    });
  });
}

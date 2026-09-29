import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { GatewayIntentBits } from "discord.js";
import { NecordModule, type NecordModuleOptions } from "necord";
import { AdminModule } from "../admin/admin.module.js";
import type { Environment } from "../config/environment.js";
import { StreamersModule } from "../streamers/streamers.module.js";
import {
  ConfigCommands,
  DiscordCommands,
  StreamerCommands
} from "./discord-commands/discord-commands.js";
import { DiscordEvents } from "./discord-events/discord-events.js";
import { DiscordService } from "./discord/discord.service.js";
import { GuildManagerGuard } from "./guild-manager.guard.js";

@Module({
  imports: [
    AdminModule,
    StreamersModule,
    NecordModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>): NecordModuleOptions => {
        const developmentGuild = config.get("DISCORD_DEVELOPMENT_GUILD_ID", { infer: true });
        return {
          token: config.get("DISCORD_TOKEN", { infer: true })!,
          intents: [GatewayIntentBits.Guilds],
          development: developmentGuild ? [developmentGuild] : false
        };
      }
    })
  ],
  providers: [
    DiscordService,
    DiscordEvents,
    DiscordCommands,
    ConfigCommands,
    StreamerCommands,
    GuildManagerGuard
  ],
  exports: [DiscordService]
})
export class DiscordModule {}

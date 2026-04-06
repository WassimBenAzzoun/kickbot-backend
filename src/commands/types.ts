import { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord-api-types/v10";
import { ChatInputCommandInteraction } from "discord.js";
import { Logger } from "pino";
import { GuildConfigService } from "../services/guildConfigService";
import { TrackedStreamerService } from "../services/trackedStreamerService";

export interface CommandServices {
  guildConfigService: GuildConfigService;
  trackedStreamerService: TrackedStreamerService;
}

export interface CommandContext {
  interaction: ChatInputCommandInteraction;
  logger: Logger;
  services: CommandServices;
}

interface CommandData {
  readonly name: string;
  toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
}

export interface SlashCommand {
  data: CommandData;
  adminOnly?: boolean;
  execute(context: CommandContext): Promise<void>;
}

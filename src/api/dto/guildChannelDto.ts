import { DiscordGuildAlertChannel } from "../types/discord";

export interface GuildChannelDto {
  id: string;
  name: string;
  type: "GUILD_TEXT" | "GUILD_ANNOUNCEMENT";
}

export function toGuildChannelDto(channel: DiscordGuildAlertChannel): GuildChannelDto {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type
  };
}

import { GuildConfig } from "@prisma/client";

export interface GuildConfigDto {
  guildId: string;
  alertChannelId: string | null;
  updatedAt: string;
}

export function toGuildConfigDto(guildId: string, config: GuildConfig | null): GuildConfigDto {
  return {
    guildId,
    alertChannelId: config?.alertChannelId ?? null,
    updatedAt: (config?.updatedAt ?? new Date()).toISOString()
  };
}
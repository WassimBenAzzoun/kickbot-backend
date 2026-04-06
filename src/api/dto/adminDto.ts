import {
  BotGuildState,
  BotStatusMessage,
  GlobalBotConfig,
  WhitelistedGuild
} from "@prisma/client";

export interface GlobalBotConfigDto {
  id: string;
  rotationEnabled: boolean;
  rotationIntervalSeconds: number;
  defaultStatusEnabled: boolean;
  defaultStatusText: string | null;
  defaultActivityType: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotStatusMessageDto {
  id: string;
  text: string;
  activityType: string;
  isEnabled: boolean;
  sortOrder: number;
  usePlaceholders: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalAdminUserDto {
  discordId: string;
  source: "env" | "database";
  createdAt: string | null;
}

export interface AdminBotGuildDto {
  guildId: string;
  guildName: string;
  iconUrl: string | null;
  configuredAlertChannelId: string | null;
  trackedStreamerCount: number;
  joinedAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface WhitelistedGuildDto {
  id: string;
  guildId: string;
  guildName: string | null;
  notes: string | null;
  addedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuildWhitelistEnforcementDto {
  enabled: boolean;
  updatedAt: string | null;
}

export function toGlobalBotConfigDto(config: GlobalBotConfig): GlobalBotConfigDto {
  return {
    id: config.id,
    rotationEnabled: config.rotationEnabled,
    rotationIntervalSeconds: config.rotationIntervalSeconds,
    defaultStatusEnabled: config.defaultStatusEnabled,
    defaultStatusText: config.defaultStatusText,
    defaultActivityType: config.defaultActivityType,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString()
  };
}

export function toBotStatusMessageDto(message: BotStatusMessage): BotStatusMessageDto {
  return {
    id: message.id,
    text: message.text,
    activityType: message.activityType,
    isEnabled: message.isEnabled,
    sortOrder: message.sortOrder,
    usePlaceholders: message.usePlaceholders,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString()
  };
}

export function toGlobalAdminUserDto(entry: {
  discordId: string;
  source: "env" | "database";
  createdAt: Date | null;
}): GlobalAdminUserDto {
  return {
    discordId: entry.discordId,
    source: entry.source,
    createdAt: entry.createdAt ? entry.createdAt.toISOString() : null
  };
}

export function toAdminBotGuildDto(
  state: BotGuildState,
  options: {
    iconUrl: string | null;
    configuredAlertChannelId: string | null;
    trackedStreamerCount: number;
  }
): AdminBotGuildDto {
  return {
    guildId: state.guildId,
    guildName: state.guildName,
    iconUrl: options.iconUrl,
    configuredAlertChannelId: options.configuredAlertChannelId,
    trackedStreamerCount: options.trackedStreamerCount,
    joinedAt: state.joinedAt.toISOString(),
    lastSeenAt: state.lastSeenAt.toISOString(),
    updatedAt: state.updatedAt.toISOString()
  };
}

export function toWhitelistedGuildDto(item: WhitelistedGuild): WhitelistedGuildDto {
  return {
    id: item.id,
    guildId: item.guildId,
    guildName: item.guildName,
    notes: item.notes,
    addedByUserId: item.addedByUserId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

export function toGuildWhitelistEnforcementDto(state: {
  enabled: boolean;
  updatedAt: Date | null;
}): GuildWhitelistEnforcementDto {
  return {
    enabled: state.enabled,
    updatedAt: state.updatedAt ? state.updatedAt.toISOString() : null
  };
}

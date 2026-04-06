export interface DiscordUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  permissions: string;
}

export interface DiscordBotGuild {
  id: string;
  name: string;
  icon: string | null;
}

export interface DiscordGuildAlertChannel {
  id: string;
  name: string;
  type: "GUILD_TEXT" | "GUILD_ANNOUNCEMENT";
}

export interface GuildAlertChannelsResult {
  source: "bot_api" | "unavailable";
  channels: DiscordGuildAlertChannel[];
}

export interface DiscordTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

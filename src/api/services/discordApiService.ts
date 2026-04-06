import axios, { AxiosError, AxiosInstance } from "axios";
import { z } from "zod";
import { env } from "../../config/env";
import { requireEnvValue } from "../../config/required";
import { ApiError } from "./errors";
import {
  DiscordBotGuild,
  DiscordGuild,
  DiscordGuildAlertChannel,
  DiscordTokenResponse,
  DiscordUser,
  GuildAlertChannelsResult
} from "../types/discord";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive()
});

const discordUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional()
});

const discordGuildSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().nullable().optional(),
  permissions: z.string().min(1)
});

const discordBotGuildSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().nullable().optional()
});

const discordChannelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.number().int()
  })
  .passthrough();

const GUILD_TEXT_CHANNEL_TYPE = 0;
const GUILD_ANNOUNCEMENT_CHANNEL_TYPE = 5;
const BOT_CHANNEL_CACHE_TTL_MS = 60_000;
const BOT_GUILD_CACHE_TTL_MS = 60_000;

export class DiscordApiService {
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly apiClient: AxiosInstance;
  private botGuildCache: { expiresAt: number; guilds: DiscordBotGuild[] } | null = null;
  private readonly botChannelCache = new Map<
    string,
    { expiresAt: number; channels: DiscordGuildAlertChannel[] }
  >();

  public constructor() {
    this.clientSecret = requireEnvValue(env.DISCORD_CLIENT_SECRET, "DISCORD_CLIENT_SECRET");
    this.redirectUri = requireEnvValue(env.DISCORD_REDIRECT_URI, "DISCORD_REDIRECT_URI");

    this.apiClient = axios.create({
      baseURL: "https://discord.com/api/v10",
      timeout: 12_000
    });
  }

  public buildLoginUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: env.DISCORD_OAUTH_SCOPES,
      state
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }

  public buildInviteUrl(): string {
    const params = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      scope: "bot applications.commands",
      permissions: env.DISCORD_BOT_PERMISSIONS
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }

  public async exchangeCodeForToken(code: string): Promise<DiscordTokenResponse> {
    const response = await this.oauthTokenRequest(
      new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: this.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: this.redirectUri
      })
    );

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? null,
      expiresIn: response.expires_in
    };
  }

  public async refreshAccessToken(refreshToken: string): Promise<DiscordTokenResponse> {
    const response = await this.oauthTokenRequest(
      new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        redirect_uri: this.redirectUri
      })
    );

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? refreshToken,
      expiresIn: response.expires_in
    };
  }

  public async fetchCurrentUser(accessToken: string): Promise<DiscordUser> {
    const data = await this.authorizedGet("/users/@me", accessToken);
    const parsed = discordUserSchema.safeParse(data);

    if (!parsed.success) {
      throw new ApiError(502, "Discord returned an unexpected user payload");
    }

    return {
      id: parsed.data.id,
      username: parsed.data.username,
      globalName: parsed.data.global_name ?? null,
      avatar: parsed.data.avatar ?? null
    };
  }

  public async fetchCurrentUserGuilds(accessToken: string): Promise<DiscordGuild[]> {
    const data = await this.authorizedGet("/users/@me/guilds", accessToken);
    const parsed = z.array(discordGuildSchema).safeParse(data);

    if (!parsed.success) {
      throw new ApiError(502, "Discord returned an unexpected guild payload");
    }

    return parsed.data.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon ?? null,
      permissions: guild.permissions
    }));
  }

  public async fetchBotGuilds(): Promise<DiscordBotGuild[] | null> {
    const botToken = env.DISCORD_TOKEN;
    if (!botToken) {
      return null;
    }

    const now = Date.now();
    if (this.botGuildCache && this.botGuildCache.expiresAt > now) {
      return this.botGuildCache.guilds;
    }

    const response = await this.apiClient.get("/users/@me/guilds", {
      headers: {
        Authorization: `Bot ${botToken}`
      },
      validateStatus: () => true
    });

    if (response.status === 429) {
      const retryAfterSeconds = this.parseRetryAfterSeconds(response.headers["retry-after"]);
      const message = retryAfterSeconds !== null
        ? `Discord API is rate limited. Retry after ${retryAfterSeconds}s.`
        : "Discord API is rate limited. Please retry shortly.";

      throw new ApiError(429, message);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(502, `Discord bot guild request failed with status ${response.status}`);
    }

    const parsed = z.array(discordBotGuildSchema).safeParse(response.data);
    if (!parsed.success) {
      throw new ApiError(502, "Discord returned an unexpected bot guild payload");
    }

    const guilds = parsed.data.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon ?? null
    }));

    this.botGuildCache = {
      guilds,
      expiresAt: now + BOT_GUILD_CACHE_TTL_MS
    };

    return guilds;
  }

  public async leaveBotGuild(guildId: string): Promise<void> {
    const botToken = env.DISCORD_TOKEN;
    if (!botToken) {
      throw new ApiError(503, "DISCORD_TOKEN is not configured");
    }

    const response = await this.apiClient.delete(`/users/@me/guilds/${guildId}`, {
      headers: {
        Authorization: `Bot ${botToken}`
      },
      validateStatus: () => true
    });

    if (response.status === 429) {
      const retryAfterSeconds = this.parseRetryAfterSeconds(response.headers["retry-after"]);
      const message = retryAfterSeconds !== null
        ? `Discord API is rate limited. Retry after ${retryAfterSeconds}s.`
        : "Discord API is rate limited. Please retry shortly.";

      throw new ApiError(429, message);
    }

    if (response.status === 404) {
      throw new ApiError(404, "Bot is not in this guild or guild does not exist");
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(502, `Discord bot leave guild failed with status ${response.status}`);
    }

    this.botGuildCache = null;
    this.botChannelCache.delete(guildId);
  }

  public async fetchGuildAlertChannelsByBot(guildId: string): Promise<GuildAlertChannelsResult> {
    const botToken = env.DISCORD_TOKEN;
    if (!botToken) {
      return {
        source: "unavailable",
        channels: []
      };
    }

    const cached = this.botChannelCache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        source: "bot_api",
        channels: cached.channels
      };
    }

    const response = await this.apiClient.get(`/guilds/${guildId}/channels`, {
      headers: {
        Authorization: `Bot ${botToken}`
      },
      validateStatus: () => true
    });

    if (response.status === 403 || response.status === 404) {
      return {
        source: "unavailable",
        channels: []
      };
    }

    if (response.status === 429) {
      const retryAfterSeconds = this.parseRetryAfterSeconds(response.headers["retry-after"]);
      const message = retryAfterSeconds !== null
        ? `Discord API is rate limited. Retry after ${retryAfterSeconds}s.`
        : "Discord API is rate limited. Please retry shortly.";

      throw new ApiError(429, message);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(502, `Discord channel list request failed with status ${response.status}`);
    }

    const parsed = z.array(discordChannelSchema).safeParse(response.data);
    if (!parsed.success) {
      throw new ApiError(502, "Discord returned an unexpected channel payload");
    }

    const channels = parsed.data
      .filter(
        (channel) =>
          channel.type === GUILD_TEXT_CHANNEL_TYPE ||
          channel.type === GUILD_ANNOUNCEMENT_CHANNEL_TYPE
      )
      .map<DiscordGuildAlertChannel>((channel) => ({
        id: channel.id,
        name: channel.name,
        type:
          channel.type === GUILD_ANNOUNCEMENT_CHANNEL_TYPE
            ? "GUILD_ANNOUNCEMENT"
            : "GUILD_TEXT"
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.botChannelCache.set(guildId, {
      channels,
      expiresAt: Date.now() + BOT_CHANNEL_CACHE_TTL_MS
    });

    return {
      source: "bot_api",
      channels
    };
  }

  public async fetchBotGuildIds(): Promise<Set<string> | null> {
    try {
      const guilds = await this.fetchBotGuilds();

      if (!guilds) {
        return null;
      }

      return new Set(guilds.map((guild) => guild.id));
    } catch {
      return null;
    }
  }

  public canManageGuild(permissions: string): boolean {
    const permissionBits = BigInt(permissions);
    const administrator = 0x8n;
    const manageGuild = 0x20n;

    return (permissionBits & administrator) === administrator ||
      (permissionBits & manageGuild) === manageGuild;
  }

  public buildGuildIconUrl(guildId: string, icon: string | null): string | null {
    if (!icon) {
      return null;
    }

    return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128`;
  }

  private async oauthTokenRequest(
    params: URLSearchParams
  ): Promise<z.infer<typeof tokenResponseSchema>> {
    try {
      const response = await this.apiClient.post("/oauth2/token", params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        validateStatus: () => true
      });

      if (response.status < 200 || response.status >= 300) {
        throw new ApiError(401, "Discord OAuth token exchange failed");
      }

      const parsed = tokenResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new ApiError(502, "Discord OAuth token response was invalid");
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw this.wrapAxiosError(error, "Discord OAuth request failed");
    }
  }

  private async authorizedGet(path: string, accessToken: string): Promise<unknown> {
    try {
      const response = await this.apiClient.get(path, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        validateStatus: () => true
      });

      if (response.status === 401) {
        throw new ApiError(401, "Discord access token is invalid or expired");
      }

      if (response.status === 429) {
        const retryAfterSeconds = this.parseRetryAfterSeconds(response.headers["retry-after"]);
        const message = retryAfterSeconds !== null
          ? `Discord API is rate limited. Retry after ${retryAfterSeconds}s.`
          : "Discord API is rate limited. Please retry shortly.";

        throw new ApiError(429, message);
      }

      if (response.status < 200 || response.status >= 300) {
        throw new ApiError(502, `Discord API request failed with status ${response.status}`);
      }

      return response.data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw this.wrapAxiosError(error, "Failed to call Discord API");
    }
  }

  private parseRetryAfterSeconds(
    retryAfterHeader: string | number | string[] | undefined
  ): number | null {
    const rawValue =
      typeof retryAfterHeader === "string"
        ? retryAfterHeader
        : typeof retryAfterHeader === "number"
          ? String(retryAfterHeader)
          : Array.isArray(retryAfterHeader)
            ? retryAfterHeader[0]
            : null;

    if (!rawValue) {
      return null;
    }

    const seconds = Number.parseFloat(rawValue);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds);
    }

    const retryAt = new Date(rawValue).getTime();
    if (Number.isNaN(retryAt)) {
      return null;
    }

    return Math.max(Math.ceil((retryAt - Date.now()) / 1000), 0);
  }

  private wrapAxiosError(error: unknown, fallbackMessage: string): ApiError {
    if (axios.isAxiosError(error)) {
      const status = (error as AxiosError).response?.status ?? 502;
      return new ApiError(status >= 400 && status < 600 ? status : 502, fallbackMessage);
    }

    return new ApiError(502, fallbackMessage);
  }
}

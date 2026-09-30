import { HttpService } from "@nestjs/axios";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AxiosError } from "axios";
import { z } from "zod";
import { ApiError } from "../common/api-error.js";
import type { Environment } from "../config/environment.js";
import type { DiscordGuildSummary } from "./auth.types.js";

const tokenSchema = z.object({ access_token: z.string() });
const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullable(),
  avatar: z.string().nullable()
});
const guildSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  permissions: z.string()
});
const botGuildSchema = z.object({ id: z.string(), name: z.string(), icon: z.string().nullable() });
const channelSchema = z.object({ id: z.string(), name: z.string().nullable(), type: z.number() });

@Injectable()
export class DiscordApiService {
  public constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Environment, true>
  ) {}

  public authorizationUrl(state: string): string {
    const query = new URLSearchParams({
      client_id: this.config.get("DISCORD_CLIENT_ID", { infer: true }),
      redirect_uri: this.config.get("DISCORD_REDIRECT_URI", { infer: true }),
      response_type: "code",
      scope: this.config.get("DISCORD_OAUTH_SCOPES", { infer: true }),
      state,
      prompt: "none"
    });
    return `https://discord.com/oauth2/authorize?${query.toString()}`;
  }

  public inviteUrl(): string {
    const query = new URLSearchParams({
      client_id: this.config.get("DISCORD_CLIENT_ID", { infer: true }),
      permissions: this.config.get("DISCORD_BOT_PERMISSIONS", { infer: true }),
      scope: "bot applications.commands"
    });
    return `https://discord.com/oauth2/authorize?${query.toString()}`;
  }

  public async exchangeCode(code: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.config.get("DISCORD_CLIENT_ID", { infer: true }),
      client_secret: this.config.get("DISCORD_CLIENT_SECRET", { infer: true }),
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.get("DISCORD_REDIRECT_URI", { infer: true })
    });
    try {
      const response = await this.http.axiosRef.post(
        "https://discord.com/api/v10/oauth2/token",
        body.toString(),
        { headers: { "content-type": "application/x-www-form-urlencoded" } }
      );
      return tokenSchema.parse(response.data).access_token;
    } catch (error) {
      throw this.discordError(error, "DISCORD_OAUTH_FAILED", "Discord OAuth exchange failed");
    }
  }

  public async currentUser(accessToken: string): Promise<z.infer<typeof userSchema>> {
    return this.userGet("/users/@me", accessToken, userSchema);
  }

  public async botUser(discordId: string): Promise<z.infer<typeof userSchema>> {
    return this.botGet(`/users/${discordId}`, userSchema);
  }

  public async userGuilds(accessToken: string): Promise<DiscordGuildSummary[]> {
    return this.userGet("/users/@me/guilds", accessToken, z.array(guildSchema));
  }

  public async botGuilds(): Promise<Array<z.infer<typeof botGuildSchema>>> {
    return this.botGet("/users/@me/guilds", z.array(botGuildSchema));
  }

  public async guildChannels(guildId: string): Promise<Array<z.infer<typeof channelSchema>>> {
    return this.botGet(`/guilds/${guildId}/channels`, z.array(channelSchema));
  }

  public async leaveGuild(guildId: string): Promise<void> {
    try {
      await this.http.axiosRef.delete(`https://discord.com/api/v10/users/@me/guilds/${guildId}`, {
        headers: this.botHeaders()
      });
    } catch (error) {
      throw this.discordError(error, "DISCORD_LEAVE_FAILED", "Could not leave the Discord guild");
    }
  }

  private async userGet<T>(path: string, accessToken: string, schema: z.ZodType<T>): Promise<T> {
    try {
      const response = await this.http.axiosRef.get(`https://discord.com/api/v10${path}`, {
        headers: { authorization: `Bearer ${accessToken}` }
      });
      return schema.parse(response.data);
    } catch (error) {
      throw this.discordError(error, "DISCORD_API_FAILED", "Discord API request failed");
    }
  }

  private async botGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    try {
      const response = await this.http.axiosRef.get(`https://discord.com/api/v10${path}`, {
        headers: this.botHeaders()
      });
      return schema.parse(response.data);
    } catch (error) {
      throw this.discordError(error, "DISCORD_API_FAILED", "Discord bot API request failed");
    }
  }

  private botHeaders(): { authorization: string } {
    const token = this.config.get("DISCORD_TOKEN", { infer: true });
    if (!token) throw new ApiError(503, "DISCORD_DISABLED", "Discord bot is not configured");
    return { authorization: `Bot ${token}` };
  }

  private discordError(error: unknown, code: string, message: string): ApiError {
    const status = error instanceof AxiosError ? error.response?.status : undefined;
    return new ApiError(status === 401 ? 401 : 502, code, message);
  }
}

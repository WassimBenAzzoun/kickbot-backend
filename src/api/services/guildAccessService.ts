import { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env";
import { ApiError, getSessionFromRequest } from "./errors";
import { DiscordApiService } from "./discordApiService";
import { SessionService } from "./sessionService";
import { DiscordGuild } from "../types/discord";

interface ManageableGuildsCacheEntry {
  expiresAt: number;
  guilds: DiscordGuild[];
}

export class GuildAccessService {
  private readonly manageableGuildsCache = new Map<string, ManageableGuildsCacheEntry>();
  private readonly inflightManageableGuildFetches = new Map<string, Promise<DiscordGuild[]>>();

  public constructor(
    private readonly discordApiService: DiscordApiService,
    private readonly sessionService: SessionService
  ) {}

  public async listManageableGuilds(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<DiscordGuild[]> {
    const session = getSessionFromRequest(request);
    const cachedGuilds = this.getCachedManageableGuilds(session.userId);
    if (cachedGuilds) {
      return cachedGuilds;
    }

    const inflight = this.inflightManageableGuildFetches.get(session.userId);
    if (inflight) {
      return inflight;
    }

    const fetchPromise = (async () => {
      const guilds = await this.fetchGuildsWithRefresh(request, reply);
      const manageable = guilds.filter((guild) => this.discordApiService.canManageGuild(guild.permissions));
      this.setCachedManageableGuilds(session.userId, manageable);
      return manageable;
    })();

    this.inflightManageableGuildFetches.set(session.userId, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      this.inflightManageableGuildFetches.delete(session.userId);
    }
  }

  public async assertUserCanManageGuild(
    request: FastifyRequest,
    reply: FastifyReply,
    guildId: string
  ): Promise<void> {
    const manageableGuilds = await this.listManageableGuilds(request, reply);
    const hasAccess = manageableGuilds.some((guild) => guild.id === guildId);

    if (!hasAccess) {
      throw new ApiError(403, "You do not have permission to manage this guild");
    }
  }

  private async fetchGuildsWithRefresh(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<DiscordGuild[]> {
    const session = getSessionFromRequest(request);

    try {
      return await this.discordApiService.fetchCurrentUserGuilds(session.accessToken);
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 401) {
        throw error;
      }

      if (!session.refreshToken) {
        throw new ApiError(401, "Session expired. Please sign in again.");
      }

      const refreshed = await this.discordApiService.refreshAccessToken(session.refreshToken);
      session.accessToken = refreshed.accessToken;
      session.refreshToken = refreshed.refreshToken;
      session.accessTokenExpiresAt = Date.now() + refreshed.expiresIn * 1000;

      request.session = session;
      this.sessionService.setSessionCookie(reply, session);

      return this.discordApiService.fetchCurrentUserGuilds(session.accessToken);
    }
  }

  private getCachedManageableGuilds(userId: string): DiscordGuild[] | null {
    const entry = this.manageableGuildsCache.get(userId);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.manageableGuildsCache.delete(userId);
      return null;
    }

    return entry.guilds;
  }

  private setCachedManageableGuilds(userId: string, guilds: DiscordGuild[]): void {
    this.manageableGuildsCache.set(userId, {
      guilds,
      expiresAt: Date.now() + env.DISCORD_GUILDS_CACHE_TTL_SECONDS * 1000
    });
  }
}

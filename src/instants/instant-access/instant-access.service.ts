import { Injectable } from "@nestjs/common";
import { DiscordApiService } from "../../auth/discord-api.service.js";
import { AdminAccessService } from "../../admin/admin-access.service.js";
import { ApiError } from "../../common/api-error.js";
import { PrismaService } from "../../database/prisma.service.js";
import { InstantAccessMode } from "../../generated/prisma/enums.js";

@Injectable()
export class InstantAccessService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly admins: AdminAccessService,
    private readonly discord: DiscordApiService
  ) {}

  public settings() {
    return this.prisma.botSettings.upsert({ where: { id: "default" }, create: {}, update: {} });
  }

  public updateSettings(data: {
    instantsEnabled?: boolean;
    instantAccessMode?: InstantAccessMode;
  }) {
    return this.prisma.botSettings.upsert({
      where: { id: "default" },
      create: data,
      update: data
    });
  }

  public async canPlay(discordId: string, guildId?: string): Promise<boolean> {
    const settings = await this.settings();
    if (!settings.instantsEnabled) return false;
    if (guildId && settings.allowlistEnforced) {
      const guild = await this.prisma.discordGuild.findUnique({ where: { id: guildId } });
      if (!guild?.isAllowed) return false;
    }
    if (await this.admins.isAdmin(discordId)) return true;
    if (settings.instantAccessMode === InstantAccessMode.EVERYONE) return true;
    return Boolean(await this.prisma.instantAllowedUser.findUnique({ where: { discordId } }));
  }

  public async requireCanPlay(discordId: string, guildId?: string): Promise<void> {
    const settings = await this.settings();
    if (!settings.instantsEnabled) {
      throw new ApiError(403, "INSTANTS_DISABLED", "Instant playback is currently disabled");
    }
    if (!(await this.canPlay(discordId, guildId))) {
      throw new ApiError(
        403,
        "INSTANT_ACCESS_DENIED",
        "You are not allowed to use instant playback"
      );
    }
  }

  public async capabilities(discordId: string, guildId: string, voiceRuntimeAvailable: boolean) {
    const settings = await this.settings();
    return {
      enabled: settings.instantsEnabled,
      accessMode: settings.instantAccessMode,
      canPlay: await this.canPlay(discordId, guildId),
      voiceRuntimeAvailable
    };
  }

  public async allowedUsers() {
    const users = await this.prisma.instantAllowedUser.findMany({ orderBy: { createdAt: "asc" } });
    return users.map((user) => ({
      ...user,
      avatarUrl:
        user.avatarHash === null
          ? null
          : `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatarHash}.png?size=128`
    }));
  }

  public async addAllowedUser(discordId: string, actorId: string) {
    const user = await this.discord.botUser(discordId);
    const saved = await this.prisma.instantAllowedUser.upsert({
      where: { discordId },
      create: {
        discordId,
        username: user.username,
        globalName: user.global_name,
        avatarHash: user.avatar,
        addedByDiscordUserId: actorId
      },
      update: {
        username: user.username,
        globalName: user.global_name,
        avatarHash: user.avatar,
        addedByDiscordUserId: actorId
      }
    });
    return {
      ...saved,
      avatarUrl:
        saved.avatarHash === null
          ? null
          : `https://cdn.discordapp.com/avatars/${saved.discordId}/${saved.avatarHash}.png?size=128`
    };
  }

  public async removeAllowedUser(discordId: string): Promise<void> {
    await this.prisma.instantAllowedUser.delete({ where: { discordId } }).catch(() => {
      throw new ApiError(404, "INSTANT_ALLOWED_USER_NOT_FOUND", "Allowed user not found");
    });
  }
}

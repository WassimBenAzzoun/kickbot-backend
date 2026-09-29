import { Injectable } from "@nestjs/common";
import { PermissionFlagsBits } from "discord.js";
import { DiscordApiService } from "../../auth/discord-api.service.js";
import type { SessionUser } from "../../auth/auth.types.js";
import { ApiError } from "../../common/api-error.js";
import { PrismaService } from "../../database/prisma.service.js";
import { GuildMembershipState } from "../../generated/prisma/enums.js";

@Injectable()
export class GuildsService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordApiService
  ) {}

  public async listManageable(user: SessionUser) {
    const guilds = (await this.discord.userGuilds(user.accessToken)).filter((guild) =>
      this.canManage(guild.permissions)
    );
    const stored = await this.prisma.discordGuild.findMany({
      where: { id: { in: guilds.map((guild) => guild.id) } },
      include: { _count: { select: { streamers: true } } }
    });
    const storedById = new Map(stored.map((guild) => [guild.id, guild]));
    return guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      iconHash: guild.icon,
      configured: Boolean(storedById.get(guild.id)?.alertChannelId),
      alertChannelId: storedById.get(guild.id)?.alertChannelId ?? null,
      isAllowed: storedById.get(guild.id)?.isAllowed ?? false,
      membershipState: storedById.get(guild.id)?.membershipState ?? GuildMembershipState.UNKNOWN,
      trackedStreamerCount: storedById.get(guild.id)?._count.streamers ?? 0
    }));
  }

  public async requireManageable(user: SessionUser, guildId: string) {
    const guild = (await this.discord.userGuilds(user.accessToken)).find(
      (candidate) => candidate.id === guildId && this.canManage(candidate.permissions)
    );
    if (!guild) throw new ApiError(403, "GUILD_ACCESS_DENIED", "You cannot manage this guild");
    return this.prisma.discordGuild.upsert({
      where: { id: guild.id },
      create: { id: guild.id, name: guild.name, iconHash: guild.icon, lastSeenAt: new Date() },
      update: { name: guild.name, iconHash: guild.icon, lastSeenAt: new Date() }
    });
  }

  public async updateAlertChannel(
    user: SessionUser,
    guildId: string,
    alertChannelId: string | null
  ) {
    await this.requireManageable(user, guildId);
    if (alertChannelId) {
      const valid = (await this.discord.guildChannels(guildId)).some(
        (channel) => channel.id === alertChannelId && [0, 5].includes(channel.type)
      );
      if (!valid) throw new ApiError(400, "INVALID_ALERT_CHANNEL", "Channel is not a text channel");
    }
    return this.prisma.discordGuild.update({ where: { id: guildId }, data: { alertChannelId } });
  }

  public async channels(user: SessionUser, guildId: string) {
    await this.requireManageable(user, guildId);
    return (await this.discord.guildChannels(guildId))
      .filter((channel) => [0, 5].includes(channel.type))
      .map((channel) => ({ id: channel.id, name: channel.name ?? "unnamed", type: channel.type }));
  }

  private canManage(value: string): boolean {
    try {
      return (BigInt(value) & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild;
    } catch {
      return false;
    }
  }
}

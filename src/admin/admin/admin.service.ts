import { Injectable } from "@nestjs/common";
import { DiscordApiService } from "../../auth/discord-api.service.js";
import { ApiError } from "../../common/api-error.js";
import { PrismaService } from "../../database/prisma.service.js";
import { BotActivityType, GuildMembershipState } from "../../generated/prisma/enums.js";
import { AdminAccessService } from "../admin-access.service.js";

@Injectable()
export class AdminService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordApiService,
    private readonly adminAccess: AdminAccessService
  ) {}

  public settings() {
    return this.prisma.botSettings.upsert({ where: { id: "default" }, create: {}, update: {} });
  }

  public updateSettings(data: {
    allowlistEnforced?: boolean;
    rotationEnabled?: boolean;
    rotationIntervalSeconds?: number;
    defaultStatusEnabled?: boolean;
    defaultStatusText?: string | null;
    defaultActivityType?: BotActivityType | null;
  }) {
    return this.prisma.botSettings.upsert({ where: { id: "default" }, create: data, update: data });
  }

  public presenceMessages() {
    return this.prisma.presenceMessage.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
  }

  public async addPresenceMessage(data: {
    text: string;
    activityType: BotActivityType;
    enabled?: boolean;
    usePlaceholders?: boolean;
  }) {
    const aggregate = await this.prisma.presenceMessage.aggregate({ _max: { sortOrder: true } });
    return this.prisma.presenceMessage.create({
      data: { ...data, sortOrder: (aggregate._max.sortOrder ?? -1) + 1 }
    });
  }

  public updatePresenceMessage(
    id: string,
    data: {
      text?: string;
      activityType?: BotActivityType;
      enabled?: boolean;
      usePlaceholders?: boolean;
    }
  ) {
    return this.prisma.presenceMessage.update({ where: { id }, data }).catch(() => {
      throw new ApiError(404, "PRESENCE_MESSAGE_NOT_FOUND", "Presence message not found");
    });
  }

  public async reorderPresenceMessages(ids: string[]): Promise<void> {
    await this.prisma.$transaction(
      ids.map((id, sortOrder) =>
        this.prisma.presenceMessage.update({ where: { id }, data: { sortOrder } })
      )
    );
  }

  public async removePresenceMessage(id: string): Promise<void> {
    await this.prisma.presenceMessage.delete({ where: { id } }).catch(() => {
      throw new ApiError(404, "PRESENCE_MESSAGE_NOT_FOUND", "Presence message not found");
    });
  }

  public async admins() {
    const databaseAdmins = await this.prisma.globalAdmin.findMany({
      orderBy: { createdAt: "asc" }
    });
    return {
      items: [
        ...this.adminAccess.configuredAdminIds().map((discordId) => ({
          discordId,
          source: "environment" as const
        })),
        ...databaseAdmins
          .filter((admin) => !this.adminAccess.isConfiguredAdmin(admin.discordId))
          .map((admin) => ({ ...admin, source: "database" as const }))
      ],
      page: { nextCursor: null, hasMore: false }
    };
  }

  public addAdmin(discordId: string) {
    return this.prisma.globalAdmin.upsert({
      where: { discordId },
      create: { discordId },
      update: {}
    });
  }

  public async removeAdmin(discordId: string): Promise<void> {
    if (this.adminAccess.isConfiguredAdmin(discordId)) {
      throw new ApiError(
        409,
        "ENV_ADMIN",
        "Environment-configured admins cannot be removed through the API"
      );
    }
    await this.prisma.globalAdmin.delete({ where: { discordId } }).catch(() => {
      throw new ApiError(404, "ADMIN_NOT_FOUND", "Global admin not found");
    });
  }

  public guilds() {
    return this.prisma.discordGuild
      .findMany({
        orderBy: [{ membershipState: "asc" }, { name: "asc" }],
        include: { _count: { select: { streamers: true } } }
      })
      .then((guilds) =>
        guilds.map(({ _count, ...guild }) => ({
          ...guild,
          trackedStreamerCount: _count.streamers
        }))
      );
  }

  public async syncGuilds() {
    const guilds = await this.discord.botGuilds();
    const now = new Date();
    await this.prisma.$transaction([
      ...guilds.map((guild) =>
        this.prisma.discordGuild.upsert({
          where: { id: guild.id },
          create: {
            id: guild.id,
            name: guild.name,
            iconHash: guild.icon,
            membershipState: GuildMembershipState.CONNECTED,
            joinedAt: now,
            lastSeenAt: now
          },
          update: {
            name: guild.name,
            iconHash: guild.icon,
            membershipState: GuildMembershipState.CONNECTED,
            leftAt: null,
            lastSeenAt: now
          }
        })
      ),
      this.prisma.discordGuild.updateMany({
        where: {
          id: { notIn: guilds.map((guild) => guild.id) },
          membershipState: GuildMembershipState.CONNECTED
        },
        data: { membershipState: GuildMembershipState.LEFT, leftAt: now }
      })
    ]);
    return this.guilds();
  }

  public async leaveGuild(guildId: string): Promise<void> {
    await this.discord.leaveGuild(guildId);
    await this.prisma.discordGuild.update({
      where: { id: guildId },
      data: { membershipState: GuildMembershipState.LEFT, leftAt: new Date() }
    });
  }

  public updateGuildAccess(
    guildId: string,
    data: { isAllowed: boolean; notes?: string | null },
    actorId: string
  ) {
    return this.prisma.discordGuild.upsert({
      where: { id: guildId },
      create: {
        id: guildId,
        isAllowed: data.isAllowed,
        allowlistNotes: data.notes,
        allowedByDiscordUserId: data.isAllowed ? actorId : null,
        allowedAt: data.isAllowed ? new Date() : null
      },
      update: {
        isAllowed: data.isAllowed,
        allowlistNotes: data.notes,
        allowedByDiscordUserId: data.isAllowed ? actorId : null,
        allowedAt: data.isAllowed ? new Date() : null
      }
    });
  }
}

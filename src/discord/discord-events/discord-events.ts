import { Injectable, Logger } from "@nestjs/common";
import { type Client, type Guild } from "discord.js";
import { Context, type ContextOf, On, Once } from "necord";
import { AdminService } from "../../admin/admin/admin.service.js";
import { PrismaService } from "../../database/prisma.service.js";
import { GuildMembershipState } from "../../generated/prisma/enums.js";
import { DiscordService } from "../discord/discord.service.js";

@Injectable()
export class DiscordEvents {
  private readonly logger = new Logger(DiscordEvents.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly discord: DiscordService
  ) {}

  @Once("clientReady")
  public async onReady(@Context() [client]: ContextOf<"clientReady">): Promise<void> {
    this.discord.setReady(true);
    this.logger.log(`Discord gateway ready as ${client.user.username}`);
    await this.admin.syncGuilds();
    await this.enforceAllowlist(client);
  }

  @On("guildCreate")
  public async onGuildCreate(@Context() [guild]: ContextOf<"guildCreate">): Promise<void> {
    const now = new Date();
    const record = await this.prisma.discordGuild.upsert({
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
        joinedAt: now,
        leftAt: null,
        lastSeenAt: now
      }
    });
    const settings = await this.prisma.botSettings.findUnique({ where: { id: "default" } });
    if (settings?.allowlistEnforced && !record.isAllowed) await guild.leave();
  }

  @On("guildDelete")
  public async onGuildDelete(@Context() [guild]: ContextOf<"guildDelete">): Promise<void> {
    await this.prisma.discordGuild.updateMany({
      where: { id: guild.id },
      data: { membershipState: GuildMembershipState.LEFT, leftAt: new Date() }
    });
  }

  @On("shardDisconnect")
  public onDisconnect(): void {
    this.discord.setReady(false);
  }

  @On("shardReady")
  public onShardReady(): void {
    this.discord.setReady(true);
  }

  @On("warn")
  public onWarn(@Context() [message]: ContextOf<"warn">): void {
    this.logger.warn(message);
  }

  @On("error")
  public onError(@Context() [error]: ContextOf<"error">): void {
    this.logger.error(error);
  }

  private async enforceAllowlist(client: Client<true>): Promise<void> {
    const settings = await this.prisma.botSettings.findUnique({ where: { id: "default" } });
    if (!settings?.allowlistEnforced) return;
    for (const guild of client.guilds.cache.values()) {
      await this.leaveIfNotAllowed(guild);
    }
  }

  private async leaveIfNotAllowed(guild: Guild): Promise<void> {
    const record = await this.prisma.discordGuild.findUnique({ where: { id: guild.id } });
    if (!record?.isAllowed) {
      this.logger.warn(`Leaving non-allowlisted guild ${guild.id}`);
      await guild.leave();
    }
  }
}

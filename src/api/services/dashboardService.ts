import { FastifyReply, FastifyRequest } from "fastify";
import { DashboardGuildDto } from "../dto/dashboardDto";
import { GuildAccessService } from "./guildAccessService";
import { DiscordApiService } from "./discordApiService";
import { AppContext } from "../../shared/appContext";

export class DashboardService {
  public constructor(
    private readonly appContext: AppContext,
    private readonly guildAccessService: GuildAccessService,
    private readonly discordApiService: DiscordApiService
  ) {}

  public async listDashboardGuilds(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<DashboardGuildDto[]> {
    const guilds = await this.guildAccessService.listManageableGuilds(request, reply);
    const guildIds = guilds.map((guild) => guild.id);

    const [guildConfigs, guildStreamerCounts, botGuildIds] = await Promise.all([
      this.appContext.guildConfigRepository.findManyByGuildIds(guildIds),
      this.appContext.trackedStreamerRepository.countByGuildIds(guildIds),
      this.discordApiService.fetchBotGuildIds()
    ]);

    const configMap = new Map(guildConfigs.map((config) => [config.guildId, config]));
    const countMap = new Map(guildStreamerCounts.map((row) => [row.guildId, row.count]));

    return guilds
      .map((guild) => ({
        guildId: guild.id,
        guildName: guild.name,
        iconUrl: this.discordApiService.buildGuildIconUrl(guild.id, guild.icon),
        userCanManage: true,
        botInGuild: botGuildIds ? botGuildIds.has(guild.id) : null,
        configuredAlertChannelId: configMap.get(guild.id)?.alertChannelId ?? null,
        trackedStreamerCount: countMap.get(guild.id) ?? 0
      }))
      .sort((a, b) => a.guildName.localeCompare(b.guildName));
  }
}
import { FastifyPluginAsync } from "fastify";
import { createAuthGuard } from "../middleware/authGuard";
import { DashboardService } from "../services/dashboardService";
import { DiscordApiService } from "../services/discordApiService";
import { GuildAccessService } from "../services/guildAccessService";
import { SessionService } from "../services/sessionService";

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const sessionService = new SessionService();
  const discordApiService = new DiscordApiService();
  const requireAuth = createAuthGuard(sessionService);
  const guildAccessService = new GuildAccessService(discordApiService, sessionService);
  const dashboardService = new DashboardService(
    fastify.appContext,
    guildAccessService,
    discordApiService
  );

  fastify.get("/dashboard/guilds", { preHandler: requireAuth }, async (request, reply) => {
    const guilds = await dashboardService.listDashboardGuilds(request, reply);

    return {
      items: guilds,
      total: guilds.length
    };
  });
};
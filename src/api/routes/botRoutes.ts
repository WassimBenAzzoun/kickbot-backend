import { FastifyPluginAsync } from "fastify";
import { DiscordApiService } from "../services/discordApiService";

export const botRoutes: FastifyPluginAsync = async (fastify) => {
  const discordApiService = new DiscordApiService();

  fastify.get("/bot/invite-link", async () => {
    return {
      inviteUrl: discordApiService.buildInviteUrl()
    };
  });
};
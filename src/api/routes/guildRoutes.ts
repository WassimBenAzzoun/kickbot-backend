import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { toGuildChannelDto } from "../dto/guildChannelDto";
import { toGuildConfigDto } from "../dto/guildDto";
import { toNotificationDto } from "../dto/notificationDto";
import { toStreamerDto } from "../dto/streamerDto";
import { createAuthGuard } from "../middleware/authGuard";
import { DiscordApiService } from "../services/discordApiService";
import { ApiError } from "../services/errors";
import { GuildAccessService } from "../services/guildAccessService";
import { SessionService } from "../services/sessionService";
import { parseWithZod } from "../services/validation";
import { kickUsernameSchema } from "../../utils/validation";

const guildParamsSchema = z.object({
  guildId: z.string().regex(/^\d+$/, "Invalid guild id")
});

const guildStreamerParamsSchema = z.object({
  guildId: z.string().regex(/^\d+$/, "Invalid guild id"),
  streamerId: z.string().min(1)
});

const updateGuildConfigBodySchema = z.object({
  alertChannelId: z.union([z.string().regex(/^\d+$/), z.null()])
});

const addStreamerBodySchema = z.object({
  streamerUsername: kickUsernameSchema
});

const patchStreamerBodySchema = z.object({
  isActive: z.boolean()
});

const notificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const guildRoutes: FastifyPluginAsync = async (fastify) => {
  const sessionService = new SessionService();
  const discordApiService = new DiscordApiService();
  const requireAuth = createAuthGuard(sessionService);
  const guildAccessService = new GuildAccessService(discordApiService, sessionService);

  fastify.get("/guilds/:guildId/config", { preHandler: requireAuth }, async (request, reply) => {
    const { guildId } = parseWithZod(guildParamsSchema, request.params, "Invalid path params");
    await guildAccessService.assertUserCanManageGuild(request, reply, guildId);

    const config = await fastify.appContext.guildConfigService.getGuildConfig(guildId);

    return {
      config: toGuildConfigDto(guildId, config)
    };
  });

  fastify.get("/guilds/:guildId/channels", { preHandler: requireAuth }, async (request, reply) => {
    const { guildId } = parseWithZod(guildParamsSchema, request.params, "Invalid path params");
    await guildAccessService.assertUserCanManageGuild(request, reply, guildId);

    const result = await discordApiService.fetchGuildAlertChannelsByBot(guildId);

    return {
      items: result.channels.map(toGuildChannelDto),
      total: result.channels.length,
      source: result.source
    };
  });

  fastify.put("/guilds/:guildId/config", { preHandler: requireAuth }, async (request, reply) => {
    const { guildId } = parseWithZod(guildParamsSchema, request.params, "Invalid path params");
    const body = parseWithZod(updateGuildConfigBodySchema, request.body, "Invalid request body");

    await guildAccessService.assertUserCanManageGuild(request, reply, guildId);

    const config = await fastify.appContext.guildConfigService.setAlertChannel(
      guildId,
      body.alertChannelId
    );

    return {
      config: toGuildConfigDto(guildId, config)
    };
  });

  fastify.get("/guilds/:guildId/streamers", { preHandler: requireAuth }, async (request, reply) => {
    const { guildId } = parseWithZod(guildParamsSchema, request.params, "Invalid path params");
    await guildAccessService.assertUserCanManageGuild(request, reply, guildId);

    const streamers = await fastify.appContext.trackedStreamerService.listGuildStreamers(guildId);

    return {
      items: streamers.map(toStreamerDto),
      total: streamers.length
    };
  });

  fastify.post("/guilds/:guildId/streamers", { preHandler: requireAuth }, async (request, reply) => {
    const { guildId } = parseWithZod(guildParamsSchema, request.params, "Invalid path params");
    const body = parseWithZod(addStreamerBodySchema, request.body, "Invalid request body");

    await guildAccessService.assertUserCanManageGuild(request, reply, guildId);

    const result = await fastify.appContext.trackedStreamerService.addKickStreamer(
      guildId,
      body.streamerUsername
    );

    if (result.type === "already_exists") {
      await reply.code(409).send({
        error: "Conflict",
        message: "Streamer already tracked in this guild",
        streamer: toStreamerDto(result.streamer)
      });
      return;
    }

    await reply.code(201).send({
      streamer: toStreamerDto(result.streamer)
    });
  });

  fastify.patch(
    "/guilds/:guildId/streamers/:streamerId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { guildId, streamerId } = parseWithZod(
        guildStreamerParamsSchema,
        request.params,
        "Invalid path params"
      );
      const body = parseWithZod(patchStreamerBodySchema, request.body, "Invalid request body");

      await guildAccessService.assertUserCanManageGuild(request, reply, guildId);

      const updated = await fastify.appContext.trackedStreamerService.setStreamerEnabledById(
        guildId,
        streamerId,
        body.isActive
      );

      if (!updated) {
        throw new ApiError(404, "Tracked streamer not found in this guild");
      }

      const streamer = await fastify.appContext.trackedStreamerService.getStreamerById(
        guildId,
        streamerId
      );

      if (!streamer) {
        throw new ApiError(404, "Tracked streamer not found in this guild");
      }

      return {
        streamer: toStreamerDto(streamer)
      };
    }
  );

  fastify.delete(
    "/guilds/:guildId/streamers/:streamerId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { guildId, streamerId } = parseWithZod(
        guildStreamerParamsSchema,
        request.params,
        "Invalid path params"
      );

      await guildAccessService.assertUserCanManageGuild(request, reply, guildId);

      const removed = await fastify.appContext.trackedStreamerService.removeStreamerById(
        guildId,
        streamerId
      );

      if (!removed) {
        throw new ApiError(404, "Tracked streamer not found in this guild");
      }

      await reply.code(204).send();
    }
  );

  fastify.get(
    "/guilds/:guildId/notifications",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { guildId } = parseWithZod(guildParamsSchema, request.params, "Invalid path params");
      const query = parseWithZod(
        notificationsQuerySchema,
        request.query,
        "Invalid query parameters"
      );

      await guildAccessService.assertUserCanManageGuild(request, reply, guildId);

      const paginated = await fastify.appContext.notificationHistoryService.listGuildNotifications(
        guildId,
        query.page,
        query.pageSize
      );

      return {
        items: paginated.items.map(toNotificationDto),
        page: paginated.page,
        pageSize: paginated.pageSize,
        total: paginated.total,
        totalPages: Math.max(1, Math.ceil(paginated.total / paginated.pageSize))
      };
    }
  );
};

import { BotActivityType } from "@prisma/client";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  toAdminBotGuildDto,
  toBotStatusMessageDto,
  toGlobalAdminUserDto,
  toGlobalBotConfigDto,
  toGuildWhitelistEnforcementDto,
  toWhitelistedGuildDto
} from "../dto/adminDto";
import { createAuthGuard } from "../middleware/authGuard";
import { createGlobalAdminGuard } from "../middleware/globalAdminGuard";
import { DiscordApiService } from "../services/discordApiService";
import { ApiError, getSessionFromRequest } from "../services/errors";
import { SessionService } from "../services/sessionService";
import { parseWithZod } from "../services/validation";
import { WhitelistedGuildAlreadyExistsError } from "../../services/whitelistedGuildService";

const activityTypeSchema = z.enum(BotActivityType);
const discordSnowflakeSchema = z.string().regex(/^\d{17,20}$/, "guildId must be a Discord snowflake");

const globalConfigBodySchema = z
  .object({
    rotationEnabled: z.boolean(),
    rotationIntervalSeconds: z.coerce.number().int().min(5).max(3600),
    defaultStatusEnabled: z.boolean(),
    defaultStatusText: z.union([z.string().trim().min(1).max(128), z.null()]),
    defaultActivityType: z.union([activityTypeSchema, z.null()])
  })
  .superRefine((value, context) => {
    if (value.defaultStatusEnabled && !value.defaultStatusText) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "defaultStatusText is required when defaultStatusEnabled is true",
        path: ["defaultStatusText"]
      });
    }

    if (value.defaultStatusEnabled && !value.defaultActivityType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "defaultActivityType is required when defaultStatusEnabled is true",
        path: ["defaultActivityType"]
      });
    }
  });

const statusMessageBodySchema = z.object({
  text: z.string().trim().min(1).max(128),
  activityType: activityTypeSchema,
  isEnabled: z.boolean().default(true),
  usePlaceholders: z.boolean().default(true)
});

const toggleStatusBodySchema = z.object({
  isEnabled: z.boolean()
});

const statusMessageIdParamsSchema = z.object({
  id: z.string().min(1)
});

const reorderBodySchema = z.object({
  idsInOrder: z.array(z.string().min(1)).min(1)
});

const globalAdminBodySchema = z.object({
  discordId: z.string().regex(/^\d+$/, "discordId must be a numeric Discord user id")
});

const globalAdminParamsSchema = z.object({
  discordId: z.string().regex(/^\d+$/, "discordId must be a numeric Discord user id")
});

const guildParamsSchema = z.object({
  guildId: z.string().regex(/^\d+$/, "guildId must be numeric")
});

const whitelistedGuildBodySchema = z.object({
  guildId: discordSnowflakeSchema,
  guildName: z.string().trim().min(1).max(100).optional(),
  notes: z.string().trim().min(1).max(500).optional()
});

const whitelistedGuildParamsSchema = z.object({
  guildId: discordSnowflakeSchema
});

const whitelistEnforcementBodySchema = z.object({
  enabled: z.boolean()
});

const AVAILABLE_PLACEHOLDERS = [
  "{guildCount}",
  "{trackedStreamerCount}",
  "{liveStreamerCount}",
  "{userCount}",
  "{botName}"
] as const;

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const sessionService = new SessionService();
  const discordApiService = new DiscordApiService();
  const requireAuth = createAuthGuard(sessionService);
  const requireGlobalAdmin = createGlobalAdminGuard(fastify.appContext.globalAdminService);
  const guardChain = [requireAuth, requireGlobalAdmin];

  async function syncBotGuildStateFromDiscord(strict: boolean): Promise<void> {
    try {
      const guilds = await discordApiService.fetchBotGuilds();

      if (!guilds) {
        return;
      }

      await fastify.appContext.botGuildStateService.syncGuildSnapshots(
        guilds.map((guild) => ({
          guildId: guild.id,
          guildName: guild.name,
          iconHash: guild.icon
        }))
      );
    } catch (error) {
      if (strict) {
        throw error;
      }

      fastify.log.warn({ err: error }, "Failed to sync bot guild state from Discord API");
    }
  }

  async function reconcileWhitelistAgainstCurrentBotGuilds(
    strict: boolean
  ): Promise<{ checked: number; left: number }> {
    try {
      const enforcementEnabled =
        await fastify.appContext.guildWhitelistSettingsService.isWhitelistEnforced();

      if (!enforcementEnabled) {
        return {
          checked: 0,
          left: 0
        };
      }

      const guilds = await discordApiService.fetchBotGuilds();
      if (!guilds) {
        return {
          checked: 0,
          left: 0
        };
      }

      let checked = 0;
      let left = 0;

      for (const guild of guilds) {
        checked += 1;

        const whitelisted = await fastify.appContext.whitelistedGuildService.isGuildWhitelisted(
          guild.id
        );

        fastify.log.info(
          {
            guildId: guild.id,
            guildName: guild.name,
            whitelisted,
            reason: "admin_reconciliation"
          },
          "Evaluated guild against whitelist from admin reconciliation"
        );

        if (whitelisted) {
          continue;
        }

        try {
          await discordApiService.leaveBotGuild(guild.id);
          await fastify.appContext.botGuildStateService.markGuildLeft(guild.id);
          left += 1;

          fastify.log.warn(
            {
              guildId: guild.id,
              guildName: guild.name,
              reason: "admin_reconciliation"
            },
            "Left non-whitelisted guild during admin reconciliation"
          );
        } catch (error) {
          if (strict) {
            throw error;
          }

          fastify.log.error(
            {
              err: error,
              guildId: guild.id,
              guildName: guild.name
            },
            "Failed to leave non-whitelisted guild during admin reconciliation"
          );
        }
      }

      return { checked, left };
    } catch (error) {
      if (strict) {
        throw error;
      }

      fastify.log.error({ err: error }, "Failed to reconcile guild whitelist from admin API");

      return {
        checked: 0,
        left: 0
      };
    }
  }

  async function listAdminBotGuildItems() {
    const states = await fastify.appContext.botGuildStateService.listInGuild();
    const guildIds = states.map((state) => state.guildId);

    const [configs, streamerCounts] = await Promise.all([
      fastify.appContext.guildConfigRepository.findManyByGuildIds(guildIds),
      fastify.appContext.trackedStreamerRepository.countByGuildIds(guildIds)
    ]);

    const configMap = new Map(configs.map((config) => [config.guildId, config]));
    const countMap = new Map(streamerCounts.map((entry) => [entry.guildId, entry.count]));

    return states.map((state) =>
      toAdminBotGuildDto(state, {
        iconUrl: discordApiService.buildGuildIconUrl(state.guildId, state.iconHash),
        configuredAlertChannelId: configMap.get(state.guildId)?.alertChannelId ?? null,
        trackedStreamerCount: countMap.get(state.guildId) ?? 0
      })
    );
  }

  fastify.get("/admin/settings/whitelist-enforcement", { preHandler: guardChain }, async () => {
    const state = await fastify.appContext.guildWhitelistSettingsService.getWhitelistEnforcementState();

    return toGuildWhitelistEnforcementDto(state);
  });

  fastify.put(
    "/admin/settings/whitelist-enforcement",
    { preHandler: guardChain },
    async (request) => {
      const body = parseWithZod(
        whitelistEnforcementBodySchema,
        request.body,
        "Invalid request body"
      );
      const session = getSessionFromRequest(request);

      const state = await fastify.appContext.guildWhitelistSettingsService.setWhitelistEnforced(
        body.enabled
      );

      fastify.log.info(
        {
          actorUserId: session.userId,
          enabled: state.enabled
        },
        "Updated guild whitelist enforcement setting"
      );

      let reconciliation: { checked: number; left: number } | undefined;

      if (state.enabled) {
        reconciliation = await reconcileWhitelistAgainstCurrentBotGuilds(false);
        await syncBotGuildStateFromDiscord(false);
      }

      return {
        ...toGuildWhitelistEnforcementDto(state),
        reconciliation
      };
    }
  );

  fastify.get("/admin/whitelist/guilds", { preHandler: guardChain }, async () => {
    const items = await fastify.appContext.whitelistedGuildService.listWhitelistedGuilds();

    return {
      items: items.map(toWhitelistedGuildDto),
      total: items.length
    };
  });

  fastify.post("/admin/whitelist/guilds", { preHandler: guardChain }, async (request, reply) => {
    const body = parseWithZod(whitelistedGuildBodySchema, request.body, "Invalid request body");
    const session = getSessionFromRequest(request);

    try {
      const item = await fastify.appContext.whitelistedGuildService.addWhitelistedGuild({
        guildId: body.guildId,
        guildName: body.guildName,
        notes: body.notes,
        addedByUserId: session.userId
      });

      fastify.log.info(
        {
          actorUserId: session.userId,
          guildId: item.guildId,
          guildName: item.guildName
        },
        "Added guild to whitelist"
      );

      await reply.code(201).send({
        item: toWhitelistedGuildDto(item)
      });
    } catch (error) {
      if (error instanceof WhitelistedGuildAlreadyExistsError) {
        throw new ApiError(409, error.message);
      }

      throw error;
    }
  });

  fastify.delete(
    "/admin/whitelist/guilds/:guildId",
    { preHandler: guardChain },
    async (request) => {
      const { guildId } = parseWithZod(
        whitelistedGuildParamsSchema,
        request.params,
        "Invalid path params"
      );
      const session = getSessionFromRequest(request);

      const removed = await fastify.appContext.whitelistedGuildService.removeWhitelistedGuild(guildId);
      if (!removed) {
        throw new ApiError(404, "Whitelisted guild not found");
      }

      fastify.log.info(
        {
          actorUserId: session.userId,
          guildId,
          guildName: removed.guildName
        },
        "Removed guild from whitelist"
      );

      let evicted = false;
      if (await fastify.appContext.guildWhitelistSettingsService.isWhitelistEnforced()) {
        try {
          await discordApiService.leaveBotGuild(guildId);
          await fastify.appContext.botGuildStateService.markGuildLeft(guildId);
          evicted = true;

          fastify.log.warn(
            {
              guildId,
              guildName: removed.guildName,
              actorUserId: session.userId,
              reason: "whitelist_removed"
            },
            "Left guild immediately after whitelist removal"
          );
        } catch (error) {
          if (error instanceof ApiError && error.statusCode === 404) {
            evicted = false;
          } else {
            fastify.log.error(
              {
                err: error,
                guildId,
                actorUserId: session.userId
              },
              "Failed immediate guild eviction after whitelist removal"
            );
          }
        }
      }

      return {
        success: true,
        guildId,
        evicted
      };
    }
  );

  fastify.get("/admin/global-config", { preHandler: guardChain }, async () => {
    const config = await fastify.appContext.globalBotConfigService.getGlobalConfig();

    return {
      config: toGlobalBotConfigDto(config),
      availableActivityTypes: Object.values(BotActivityType),
      availablePlaceholders: AVAILABLE_PLACEHOLDERS
    };
  });

  fastify.put("/admin/global-config", { preHandler: guardChain }, async (request) => {
    const body = parseWithZod(globalConfigBodySchema, request.body, "Invalid request body");

    const config = await fastify.appContext.globalBotConfigService.updateGlobalConfig({
      rotationEnabled: body.rotationEnabled,
      rotationIntervalSeconds: body.rotationIntervalSeconds,
      defaultStatusEnabled: body.defaultStatusEnabled,
      defaultStatusText: body.defaultStatusText,
      defaultActivityType: body.defaultActivityType
    });

    return {
      config: toGlobalBotConfigDto(config)
    };
  });

  fastify.get("/admin/status-messages", { preHandler: guardChain }, async () => {
    const items = await fastify.appContext.botStatusMessageService.listAll();

    return {
      items: items.map(toBotStatusMessageDto),
      total: items.length,
      availableActivityTypes: Object.values(BotActivityType),
      availablePlaceholders: AVAILABLE_PLACEHOLDERS
    };
  });

  fastify.post("/admin/status-messages", { preHandler: guardChain }, async (request, reply) => {
    const body = parseWithZod(statusMessageBodySchema, request.body, "Invalid request body");

    const item = await fastify.appContext.botStatusMessageService.createStatusMessage({
      text: body.text,
      activityType: body.activityType,
      isEnabled: body.isEnabled,
      usePlaceholders: body.usePlaceholders
    });

    await reply.code(201).send({
      item: toBotStatusMessageDto(item)
    });
  });

  fastify.put("/admin/status-messages/:id", { preHandler: guardChain }, async (request) => {
    const { id } = parseWithZod(statusMessageIdParamsSchema, request.params, "Invalid path params");
    const body = parseWithZod(statusMessageBodySchema, request.body, "Invalid request body");

    const updated = await fastify.appContext.botStatusMessageService.updateStatusMessage(id, {
      text: body.text,
      activityType: body.activityType,
      isEnabled: body.isEnabled,
      usePlaceholders: body.usePlaceholders
    });

    if (!updated) {
      throw new ApiError(404, "Status message not found");
    }

    return {
      item: toBotStatusMessageDto(updated)
    };
  });

  fastify.patch(
    "/admin/status-messages/:id/toggle",
    { preHandler: guardChain },
    async (request) => {
      const { id } = parseWithZod(statusMessageIdParamsSchema, request.params, "Invalid path params");
      const body = parseWithZod(toggleStatusBodySchema, request.body, "Invalid request body");

      const updated = await fastify.appContext.botStatusMessageService.toggleStatusMessage(
        id,
        body.isEnabled
      );

      if (!updated) {
        throw new ApiError(404, "Status message not found");
      }

      return {
        item: toBotStatusMessageDto(updated)
      };
    }
  );

  fastify.patch("/admin/status-messages/reorder", { preHandler: guardChain }, async (request) => {
    const body = parseWithZod(reorderBodySchema, request.body, "Invalid request body");

    const deduplicatedIds = Array.from(new Set(body.idsInOrder));
    if (deduplicatedIds.length !== body.idsInOrder.length) {
      throw new ApiError(400, "idsInOrder must not contain duplicates");
    }

    try {
      const items = await fastify.appContext.botStatusMessageService.reorderStatusMessages(
        deduplicatedIds
      );

      return {
        items: items.map(toBotStatusMessageDto),
        total: items.length
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid status id in reorder payload")) {
        throw new ApiError(400, error.message);
      }

      throw error;
    }
  });

  fastify.delete("/admin/status-messages/:id", { preHandler: guardChain }, async (request, reply) => {
    const { id } = parseWithZod(statusMessageIdParamsSchema, request.params, "Invalid path params");

    const deleted = await fastify.appContext.botStatusMessageService.deleteStatusMessage(id);

    if (!deleted) {
      throw new ApiError(404, "Status message not found");
    }

    await reply.code(204).send();
  });

  fastify.get("/admin/global-admins", { preHandler: guardChain }, async () => {
    const items = await fastify.appContext.globalAdminService.listGlobalAdmins();

    return {
      items: items.map(toGlobalAdminUserDto),
      total: items.length
    };
  });

  fastify.post("/admin/global-admins", { preHandler: guardChain }, async (request, reply) => {
    const body = parseWithZod(globalAdminBodySchema, request.body, "Invalid request body");

    const item = await fastify.appContext.globalAdminService.addGlobalAdmin(body.discordId);

    await reply.code(201).send({
      item: toGlobalAdminUserDto(item)
    });
  });

  fastify.delete("/admin/global-admins/:discordId", { preHandler: guardChain }, async (request, reply) => {
    const { discordId } = parseWithZod(globalAdminParamsSchema, request.params, "Invalid path params");
    const session = getSessionFromRequest(request);

    if (session.userId === discordId) {
      throw new ApiError(400, "You cannot remove your own global admin access");
    }

    const result = await fastify.appContext.globalAdminService.removeGlobalAdmin(discordId);

    if (result === "env_managed") {
      throw new ApiError(409, "This global admin is managed by env variable GLOBAL_ADMIN_DISCORD_IDS");
    }

    if (result === "not_found") {
      throw new ApiError(404, "Global admin not found");
    }

    await reply.code(204).send();
  });

  fastify.get("/admin/bot-guilds", { preHandler: guardChain }, async () => {
    await syncBotGuildStateFromDiscord(false);
    const items = await listAdminBotGuildItems();

    return {
      items,
      total: items.length
    };
  });

  fastify.post("/admin/bot-guilds/sync", { preHandler: guardChain }, async () => {
    await syncBotGuildStateFromDiscord(true);
    const items = await listAdminBotGuildItems();

    return {
      items,
      total: items.length,
      syncedAt: new Date().toISOString()
    };
  });

  fastify.delete("/admin/bot-guilds/:guildId/leave", { preHandler: guardChain }, async (request) => {
    const { guildId } = parseWithZod(guildParamsSchema, request.params, "Invalid path params");

    await discordApiService.leaveBotGuild(guildId);
    await fastify.appContext.botGuildStateService.markGuildLeft(guildId);

    return {
      success: true,
      guildId
    };
  });
};

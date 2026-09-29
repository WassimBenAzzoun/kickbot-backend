import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../auth/auth.types.js";
import { SessionGuard } from "../../auth/session.guard.js";
import {
  ApiErrors,
  ApiSchemaResponse,
  collectionResponseSchema,
  discordChannelResponseSchema,
  discordGuildResponseSchema,
  manageableGuildResponseSchema,
  notificationResponseSchema,
  trackedStreamerResponseSchema
} from "../../common/api-documentation.js";
import { NotificationsService } from "../../notifications/notifications/notifications.service.js";
import { StreamersService } from "../../streamers/streamers/streamers.service.js";
import { GuildsService } from "./guilds.service.js";

const guildParamsSchema = z.object({ guildId: z.string().regex(/^\d+$/) });
const streamerParamsSchema = guildParamsSchema.extend({ streamerId: z.uuid() });
const guildPatchSchema = z.object({ alertChannelId: z.string().regex(/^\d+$/).nullable() });
const createStreamerSchema = z.object({ username: z.string().trim().min(1).max(64) });
const updateStreamerSchema = z.object({ enabled: z.boolean() });
const notificationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
const manageableGuildCollectionSchema = collectionResponseSchema(manageableGuildResponseSchema);
const channelCollectionSchema = collectionResponseSchema(discordChannelResponseSchema);
const streamerCollectionSchema = collectionResponseSchema(trackedStreamerResponseSchema);
const notificationCollectionSchema = collectionResponseSchema(notificationResponseSchema);

@Controller("guilds")
@UseGuards(SessionGuard)
@ApiTags("Guilds")
@ApiCookieAuth("sessionCookie")
@ApiErrors(401, 429, 500)
export class GuildsController {
  public constructor(
    private readonly guilds: GuildsService,
    private readonly streamers: StreamersService,
    private readonly notifications: NotificationsService
  ) {}

  @Get()
  @ApiOperation({ summary: "List Discord guilds the current user can manage" })
  @ApiSchemaResponse(manageableGuildCollectionSchema)
  public async list(@Req() request: AuthenticatedRequest) {
    return {
      items: await this.guilds.listManageable(request.user),
      page: { nextCursor: null, hasMore: false }
    };
  }

  @Get(":guildId")
  @ApiOperation({ summary: "Get a manageable guild and its KickBot configuration" })
  @ApiSchemaResponse(discordGuildResponseSchema)
  @ApiErrors(403)
  public get(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    return this.guilds.requireManageable(request.user, params.guildId);
  }

  @Patch(":guildId")
  @ApiOperation({ summary: "Set or clear a guild's Discord alert channel" })
  @ApiSchemaResponse(discordGuildResponseSchema)
  @ApiErrors(400, 403)
  public patch(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Body({ schema: guildPatchSchema }) body: z.infer<typeof guildPatchSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    return this.guilds.updateAlertChannel(request.user, params.guildId, body.alertChannelId);
  }

  @Get(":guildId/channels")
  @ApiOperation({ summary: "List eligible Discord alert channels" })
  @ApiSchemaResponse(channelCollectionSchema)
  @ApiErrors(403, 502)
  public async channels(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    return {
      items: await this.guilds.channels(request.user, params.guildId),
      page: { nextCursor: null, hasMore: false }
    };
  }

  @Get(":guildId/streamers")
  @ApiOperation({ summary: "List tracked Kick streamers for a guild" })
  @ApiSchemaResponse(streamerCollectionSchema)
  @ApiErrors(403)
  public async listStreamers(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    return {
      items: await this.streamers.list(params.guildId),
      page: { nextCursor: null, hasMore: false }
    };
  }

  @Post(":guildId/streamers")
  @ApiOperation({ summary: "Track a Kick streamer in a guild" })
  @ApiSchemaResponse(trackedStreamerResponseSchema, { status: 201 })
  @ApiErrors(403, 409)
  public async addStreamer(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Body({ schema: createStreamerSchema }) body: z.infer<typeof createStreamerSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    return this.streamers.add(params.guildId, body.username);
  }

  @Patch(":guildId/streamers/:streamerId")
  @ApiOperation({ summary: "Enable or disable a tracked streamer" })
  @ApiSchemaResponse(trackedStreamerResponseSchema)
  @ApiErrors(403, 404)
  public async patchStreamer(
    @Param({ schema: streamerParamsSchema }) params: z.infer<typeof streamerParamsSchema>,
    @Body({ schema: updateStreamerSchema }) body: z.infer<typeof updateStreamerSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    return this.streamers.update(params.guildId, params.streamerId, body.enabled);
  }

  @Delete(":guildId/streamers/:streamerId")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a tracked streamer" })
  @ApiNoContentResponse({ description: "The streamer was removed." })
  @ApiErrors(403, 404)
  public async removeStreamer(
    @Param({ schema: streamerParamsSchema }) params: z.infer<typeof streamerParamsSchema>,
    @Req() request: AuthenticatedRequest
  ): Promise<void> {
    await this.guilds.requireManageable(request.user, params.guildId);
    await this.streamers.remove(params.guildId, params.streamerId);
  }

  @Get(":guildId/notifications")
  @ApiOperation({ summary: "List delivered live notifications using cursor pagination" })
  @ApiSchemaResponse(notificationCollectionSchema)
  @ApiErrors(400, 403)
  public async listNotifications(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Query({ schema: notificationQuerySchema }) query: z.infer<typeof notificationQuerySchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    return this.notifications.list(params.guildId, query.cursor, query.limit);
  }
}

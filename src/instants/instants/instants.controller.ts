import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
  instantCapabilitiesResponseSchema,
  instantEnqueueResponseSchema,
  instantQueueStatusResponseSchema,
  instantSearchResultResponseSchema,
  instantVoiceChannelResponseSchema
} from "../../common/api-documentation.js";
import { GuildsService } from "../../guilds/guilds/guilds.service.js";
import { InstantAccessService } from "../instant-access/instant-access.service.js";
import { MyinstantsService } from "../myinstants/myinstants.service.js";
import { VoiceQueueService } from "../voice-queue/voice-queue.service.js";

const guildParamsSchema = z.object({ guildId: z.string().regex(/^\d+$/) });
const searchQuerySchema = z.object({
  query: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(25).default(20)
});
const enqueueSchema = z.object({
  voiceChannelId: z.string().regex(/^\d+$/),
  instantUrl: z.url()
});
const searchCollectionSchema = collectionResponseSchema(instantSearchResultResponseSchema);
const voiceChannelCollectionSchema = collectionResponseSchema(instantVoiceChannelResponseSchema);

@Controller("guilds/:guildId/instants")
@UseGuards(SessionGuard)
@ApiTags("Instants")
@ApiCookieAuth("sessionCookie")
@ApiErrors(401, 403, 429, 500)
export class InstantsController {
  public constructor(
    private readonly guilds: GuildsService,
    private readonly access: InstantAccessService,
    private readonly provider: MyinstantsService,
    private readonly voice: VoiceQueueService
  ) {}

  @Get("capabilities")
  @ApiOperation({ summary: "Get instant playback access and runtime capabilities" })
  @ApiSchemaResponse(instantCapabilitiesResponseSchema)
  public async capabilities(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    return {
      ...(await this.access.capabilities(
        request.user.id,
        params.guildId,
        this.voice.isRuntimeAvailable()
      )),
      limits: this.voice.limits()
    };
  }

  @Get("voice-channels")
  @ApiOperation({ summary: "List voice channels where the bot can play instants" })
  @ApiSchemaResponse(voiceChannelCollectionSchema)
  @ApiErrors(502, 503)
  public async voiceChannels(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    return {
      items: await this.voice.listVoiceChannels(params.guildId),
      page: { nextCursor: null, hasMore: false }
    };
  }

  @Get("search")
  @ApiOperation({ summary: "Search Myinstants for playable sounds" })
  @ApiSchemaResponse(searchCollectionSchema)
  @ApiErrors(400, 502)
  public async search(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Query({ schema: searchQuerySchema }) query: z.infer<typeof searchQuerySchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    await this.access.requireCanPlay(request.user.id, params.guildId);
    return {
      items: await this.provider.search(query.query, query.limit),
      page: { nextCursor: null, hasMore: false }
    };
  }

  @Post("queue")
  @ApiOperation({ summary: "Queue a Myinstants sound in a Discord voice channel" })
  @ApiSchemaResponse(instantEnqueueResponseSchema, { status: 201 })
  @ApiErrors(400, 409, 502, 503)
  public async enqueue(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Body({ schema: enqueueSchema }) body: z.infer<typeof enqueueSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    await this.access.requireCanPlay(request.user.id, params.guildId);
    const instant = await this.provider.resolve(body.instantUrl);
    return this.voice.enqueue({
      guildId: params.guildId,
      voiceChannelId: body.voiceChannelId,
      instant,
      requestedByDiscordUserId: request.user.id,
      requestedVia: "DASHBOARD"
    });
  }

  @Get("queue")
  @ApiOperation({ summary: "Get current and queued instant playback" })
  @ApiSchemaResponse(instantQueueStatusResponseSchema)
  public async queue(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    return this.voice.status(params.guildId);
  }

  @Delete("queue")
  @HttpCode(204)
  @ApiOperation({ summary: "Stop instant playback, clear the queue, and leave voice" })
  @ApiNoContentResponse({ description: "Instant playback stopped." })
  public async stop(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ): Promise<void> {
    await this.guilds.requireManageable(request.user, params.guildId);
    this.voice.stopGuild(params.guildId);
  }
}

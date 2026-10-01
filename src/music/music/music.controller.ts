import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
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
  musicCapabilitiesResponseSchema,
  musicEnqueueResponseSchema,
  musicQueueStatusResponseSchema,
  successResponseSchema
} from "../../common/api-documentation.js";
import { GuildsService } from "../../guilds/guilds/guilds.service.js";
import { InstantAccessService } from "../../instants/instant-access/instant-access.service.js";
import { MusicQueueService } from "../music-queue/music-queue.service.js";
import { MusicSourceService } from "../music-source/music-source.service.js";

const guildParamsSchema = z.object({ guildId: z.string().regex(/^\d+$/) });
const enqueueSchema = z.object({
  voiceChannelId: z.string().regex(/^\d+$/),
  sourceUrl: z.url()
});

@Controller("guilds/:guildId/music")
@UseGuards(SessionGuard)
@ApiTags("Music")
@ApiCookieAuth("sessionCookie")
@ApiErrors(401, 403, 429, 500)
export class MusicController {
  public constructor(
    private readonly guilds: GuildsService,
    private readonly access: InstantAccessService,
    private readonly sources: MusicSourceService,
    private readonly music: MusicQueueService
  ) {}

  @Get("capabilities")
  @ApiOperation({ summary: "Get music playback access and runtime capabilities" })
  @ApiSchemaResponse(musicCapabilitiesResponseSchema)
  public async capabilities(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    const settings = await this.access.capabilities(
      request.user.id,
      params.guildId,
      this.music.isRuntimeAvailable()
    );
    return {
      enabled: settings.enabled,
      accessMode: settings.accessMode,
      canPlay: settings.canPlay,
      voiceRuntimeAvailable: settings.voiceRuntimeAvailable,
      spotifyAvailable: this.sources.spotifyAvailable(),
      limits: this.music.limits()
    };
  }

  @Post("queue")
  @ApiOperation({ summary: "Resolve and queue a YouTube or Spotify URL" })
  @ApiSchemaResponse(musicEnqueueResponseSchema, { status: 201 })
  @ApiErrors(400, 409, 422, 502, 503, 504)
  public async enqueue(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Body({ schema: enqueueSchema }) body: z.infer<typeof enqueueSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    return this.music.enqueue({
      guildId: params.guildId,
      voiceChannelId: body.voiceChannelId,
      sourceUrl: body.sourceUrl,
      requestedByDiscordUserId: request.user.id,
      requestedVia: "DASHBOARD"
    });
  }

  @Get("queue")
  @ApiOperation({ summary: "Get current music playback and queue" })
  @ApiSchemaResponse(musicQueueStatusResponseSchema)
  public async queue(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.guilds.requireManageable(request.user, params.guildId);
    return this.music.status(params.guildId);
  }

  @Post("pause")
  @HttpCode(200)
  @ApiOperation({ summary: "Pause music playback" })
  @ApiSchemaResponse(successResponseSchema)
  public async pause(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.requireControl(request, params.guildId);
    this.music.pause(params.guildId);
    return { success: true as const };
  }

  @Post("resume")
  @HttpCode(200)
  @ApiOperation({ summary: "Resume music playback" })
  @ApiSchemaResponse(successResponseSchema)
  public async resume(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.requireControl(request, params.guildId);
    this.music.resume(params.guildId);
    return { success: true as const };
  }

  @Post("skip")
  @HttpCode(200)
  @ApiOperation({ summary: "Skip the current music track" })
  @ApiSchemaResponse(successResponseSchema)
  public async skip(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    await this.requireControl(request, params.guildId);
    this.music.skip(params.guildId);
    return { success: true as const };
  }

  @Delete("queue")
  @HttpCode(204)
  @ApiOperation({ summary: "Stop music and clear only the music queue" })
  @ApiNoContentResponse({ description: "Music playback stopped." })
  public async stop(
    @Param({ schema: guildParamsSchema }) params: z.infer<typeof guildParamsSchema>,
    @Req() request: AuthenticatedRequest
  ): Promise<void> {
    await this.requireControl(request, params.guildId);
    this.music.stop(params.guildId);
  }

  private async requireControl(request: AuthenticatedRequest, guildId: string): Promise<void> {
    await this.guilds.requireManageable(request.user, guildId);
    await this.access.requireCanPlay(request.user.id, guildId);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { GlobalAdminGuard } from "../../admin/global-admin.guard.js";
import { ModuleRef } from "@nestjs/core";
import type { AuthenticatedRequest } from "../../auth/auth.types.js";
import { SessionGuard } from "../../auth/session.guard.js";
import {
  ApiErrors,
  ApiSchemaResponse,
  collectionResponseSchema,
  instantAllowedUserResponseSchema,
  instantSettingsResponseSchema
} from "../../common/api-documentation.js";
import { InstantAccessMode } from "../../generated/prisma/enums.js";
import { InstantAccessService } from "../instant-access/instant-access.service.js";
import { VoiceQueueService } from "../voice-queue/voice-queue.service.js";
import { DiscordVoiceService } from "../../voice/discord-voice.service.js";

const settingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  accessMode: z.enum(InstantAccessMode).optional()
});
const discordIdSchema = z.object({ discordId: z.string().regex(/^\d+$/) });
const allowedUserCollectionSchema = collectionResponseSchema(instantAllowedUserResponseSchema);

@Controller("admin/instants")
@UseGuards(SessionGuard, GlobalAdminGuard)
@ApiTags("Administration - Instants")
@ApiCookieAuth("sessionCookie")
@ApiErrors(401, 403, 429, 500)
export class AdminInstantsController {
  public constructor(
    private readonly access: InstantAccessService,
    private readonly voice: VoiceQueueService,
    private readonly discordVoice: DiscordVoiceService,
    private readonly moduleRef: ModuleRef
  ) {}

  @Get("settings")
  @ApiOperation({ summary: "Get global instant playback settings" })
  @ApiSchemaResponse(instantSettingsResponseSchema)
  public async settings() {
    const settings = await this.access.settings();
    return {
      enabled: settings.instantsEnabled,
      accessMode: settings.instantAccessMode,
      limits: this.voice.limits()
    };
  }

  @Patch("settings")
  @ApiOperation({ summary: "Update global instant playback settings" })
  @ApiSchemaResponse(instantSettingsResponseSchema)
  public async patchSettings(
    @Body({ schema: settingsPatchSchema }) body: z.infer<typeof settingsPatchSchema>
  ) {
    const settings = await this.access.updateSettings({
      ...(body.enabled === undefined ? {} : { instantsEnabled: body.enabled }),
      ...(body.accessMode === undefined ? {} : { instantAccessMode: body.accessMode })
    });
    if (body.enabled === false) {
      this.voice.stopAll();
      const { MusicQueueService } = await import("../../music/music-queue/music-queue.service.js");
      this.moduleRef.get(MusicQueueService, { strict: false }).stopAll();
      this.discordVoice.destroyAll();
    }
    return {
      enabled: settings.instantsEnabled,
      accessMode: settings.instantAccessMode,
      limits: this.voice.limits()
    };
  }

  @Get("allowed-users")
  @ApiOperation({ summary: "List Discord users allowed to play instants" })
  @ApiSchemaResponse(allowedUserCollectionSchema)
  public async allowedUsers() {
    return {
      items: await this.access.allowedUsers(),
      page: { nextCursor: null, hasMore: false }
    };
  }

  @Post("allowed-users")
  @ApiOperation({ summary: "Add a Discord user to the instant playback allowlist" })
  @ApiSchemaResponse(instantAllowedUserResponseSchema, { status: 201 })
  @ApiErrors(502)
  public addAllowedUser(
    @Body({ schema: discordIdSchema }) body: z.infer<typeof discordIdSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    return this.access.addAllowedUser(body.discordId, request.user.id);
  }

  @Delete("allowed-users/:discordId")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a Discord user from the instant playback allowlist" })
  @ApiNoContentResponse({ description: "The user was removed from the allowlist." })
  @ApiErrors(404)
  public removeAllowedUser(
    @Param({ schema: discordIdSchema }) params: z.infer<typeof discordIdSchema>
  ): Promise<void> {
    return this.access.removeAllowedUser(params.discordId);
  }
}

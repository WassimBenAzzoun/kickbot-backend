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
import type { AuthenticatedRequest } from "../../auth/auth.types.js";
import { SessionGuard } from "../../auth/session.guard.js";
import {
  ApiErrors,
  ApiSchemaResponse,
  adminGuildResponseSchema,
  botSettingsResponseSchema,
  collectionResponseSchema,
  discordGuildResponseSchema,
  globalAdminResponseSchema,
  presenceMessageResponseSchema
} from "../../common/api-documentation.js";
import { BotActivityType } from "../../generated/prisma/enums.js";
import { GlobalAdminGuard } from "../global-admin.guard.js";
import { AdminService } from "./admin.service.js";

const settingsSchema = z.object({
  allowlistEnforced: z.boolean().optional(),
  rotationEnabled: z.boolean().optional(),
  rotationIntervalSeconds: z.number().int().min(10).optional(),
  defaultStatusEnabled: z.boolean().optional(),
  defaultStatusText: z.string().trim().max(128).nullable().optional(),
  defaultActivityType: z.enum(BotActivityType).nullable().optional()
});
const presenceSchema = z.object({
  text: z.string().trim().min(1).max(128),
  activityType: z.enum(BotActivityType),
  enabled: z.boolean().optional(),
  usePlaceholders: z.boolean().optional()
});
const presencePatchSchema = presenceSchema.partial();
const reorderSchema = z.object({ ids: z.array(z.uuid()).min(1) });
const idSchema = z.object({ id: z.uuid() });
const discordIdSchema = z.object({ discordId: z.string().regex(/^\d+$/) });
const guildIdSchema = z.object({ guildId: z.string().regex(/^\d+$/) });
const accessSchema = z.object({
  isAllowed: z.boolean(),
  notes: z.string().trim().max(500).nullable().optional()
});
const presenceCollectionSchema = collectionResponseSchema(presenceMessageResponseSchema);
const adminCollectionSchema = collectionResponseSchema(globalAdminResponseSchema);
const guildCollectionSchema = collectionResponseSchema(adminGuildResponseSchema);

@Controller("admin")
@UseGuards(SessionGuard, GlobalAdminGuard)
@ApiTags("Administration")
@ApiCookieAuth("sessionCookie")
@ApiErrors(401, 403, 429, 500)
export class AdminController {
  public constructor(private readonly admin: AdminService) {}

  @Get("settings")
  @ApiOperation({ summary: "Get global bot settings" })
  @ApiSchemaResponse(botSettingsResponseSchema)
  public settings() {
    return this.admin.settings();
  }
  @Patch("settings")
  @ApiOperation({ summary: "Update global bot settings" })
  @ApiSchemaResponse(botSettingsResponseSchema)
  public patchSettings(@Body({ schema: settingsSchema }) body: z.infer<typeof settingsSchema>) {
    return this.admin.updateSettings(body);
  }
  @Get("presence-messages")
  @ApiOperation({ summary: "List ordered Discord presence messages" })
  @ApiSchemaResponse(presenceCollectionSchema)
  public async messages() {
    return {
      items: await this.admin.presenceMessages(),
      page: { nextCursor: null, hasMore: false }
    };
  }
  @Post("presence-messages")
  @ApiOperation({ summary: "Create a Discord presence message" })
  @ApiSchemaResponse(presenceMessageResponseSchema, { status: 201 })
  public addMessage(@Body({ schema: presenceSchema }) body: z.infer<typeof presenceSchema>) {
    return this.admin.addPresenceMessage(body);
  }
  @Patch("presence-messages/order")
  @HttpCode(204)
  @ApiOperation({ summary: "Replace the presence-message order" })
  @ApiNoContentResponse({ description: "The order was updated." })
  public reorder(@Body({ schema: reorderSchema }) body: z.infer<typeof reorderSchema>) {
    return this.admin.reorderPresenceMessages(body.ids);
  }
  @Patch("presence-messages/:id")
  @ApiOperation({ summary: "Update a Discord presence message" })
  @ApiSchemaResponse(presenceMessageResponseSchema)
  @ApiErrors(404)
  public patchMessage(
    @Param({ schema: idSchema }) params: z.infer<typeof idSchema>,
    @Body({ schema: presencePatchSchema }) body: z.infer<typeof presencePatchSchema>
  ) {
    return this.admin.updatePresenceMessage(params.id, body);
  }
  @Delete("presence-messages/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a Discord presence message" })
  @ApiNoContentResponse({ description: "The presence message was deleted." })
  @ApiErrors(404)
  public removeMessage(@Param({ schema: idSchema }) params: z.infer<typeof idSchema>) {
    return this.admin.removePresenceMessage(params.id);
  }
  @Get("admins")
  @ApiOperation({ summary: "List global administrators" })
  @ApiSchemaResponse(adminCollectionSchema)
  public admins() {
    return this.admin.admins();
  }
  @Post("admins")
  @ApiOperation({ summary: "Add a database-backed global administrator" })
  @ApiSchemaResponse(globalAdminResponseSchema, { status: 201 })
  public addAdmin(@Body({ schema: discordIdSchema }) body: z.infer<typeof discordIdSchema>) {
    return this.admin.addAdmin(body.discordId);
  }
  @Delete("admins/:discordId")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a database-backed global administrator" })
  @ApiNoContentResponse({ description: "The administrator was removed." })
  @ApiErrors(404, 409)
  public removeAdmin(@Param({ schema: discordIdSchema }) params: z.infer<typeof discordIdSchema>) {
    return this.admin.removeAdmin(params.discordId);
  }
  @Get("guilds")
  @ApiOperation({ summary: "List all known Discord guilds" })
  @ApiSchemaResponse(guildCollectionSchema)
  public async guilds() {
    return { items: await this.admin.guilds(), page: { nextCursor: null, hasMore: false } };
  }
  @Post("guilds/sync")
  @ApiOperation({ summary: "Reconcile database guild state with Discord" })
  @ApiSchemaResponse(guildCollectionSchema, { status: 201 })
  @ApiErrors(502)
  public async syncGuilds() {
    return { items: await this.admin.syncGuilds(), page: { nextCursor: null, hasMore: false } };
  }
  @Post("guilds/:guildId/leave")
  @HttpCode(204)
  @ApiOperation({ summary: "Make the bot leave a Discord guild" })
  @ApiNoContentResponse({ description: "The bot left the guild." })
  @ApiErrors(502)
  public leaveGuild(@Param({ schema: guildIdSchema }) params: z.infer<typeof guildIdSchema>) {
    return this.admin.leaveGuild(params.guildId);
  }
  @Patch("guilds/:guildId/access")
  @ApiOperation({ summary: "Allow or deny a guild when allowlist enforcement is enabled" })
  @ApiSchemaResponse(discordGuildResponseSchema)
  public access(
    @Param({ schema: guildIdSchema }) params: z.infer<typeof guildIdSchema>,
    @Body({ schema: accessSchema }) body: z.infer<typeof accessSchema>,
    @Req() request: AuthenticatedRequest
  ) {
    return this.admin.updateGuildAccess(params.guildId, body, request.user.id);
  }
}

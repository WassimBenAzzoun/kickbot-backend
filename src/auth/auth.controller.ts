import { Controller, Get, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiCookieAuth, ApiFoundResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AdminAccessService } from "../admin/admin-access.service.js";
import { ApiError } from "../common/api-error.js";
import {
  ApiErrors,
  ApiSchemaResponse,
  inviteUrlResponseSchema,
  sessionUserResponseSchema,
  successResponseSchema
} from "../common/api-documentation.js";
import type { Environment } from "../config/environment.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import { DiscordApiService } from "./discord-api.service.js";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session.service.js";

const callbackSchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

@Controller("auth")
@ApiTags("Authentication")
export class AuthController {
  public constructor(
    private readonly discord: DiscordApiService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<Environment, true>,
    private readonly adminAccess: AdminAccessService
  ) {}

  @Get("discord/login")
  @ApiOperation({
    summary: "Start Discord OAuth",
    description: "Sets a short-lived OAuth state cookie and redirects the browser to Discord."
  })
  @ApiFoundResponse({ description: "Redirects to the Discord authorization page." })
  public async login(@Res() response: FastifyReply): Promise<void> {
    const { state, token } = await this.sessions.createOAuthState();
    this.sessions.setOAuthStateCookie(response, token);
    await response.redirect(this.discord.authorizationUrl(state));
  }

  @Get("discord/callback")
  @ApiOperation({
    summary: "Complete Discord OAuth",
    description:
      "Validates OAuth state, creates an encrypted session cookie, and redirects to the frontend."
  })
  @ApiFoundResponse({ description: "Redirects to the frontend authentication callback." })
  @ApiErrors(400, 502)
  public async callback(
    @Query({ schema: callbackSchema }) query: z.infer<typeof callbackSchema>,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply
  ): Promise<void> {
    const stateCookie = this.sessions.cookieFromHeader(
      request.headers.cookie,
      this.config.get("OAUTH_STATE_COOKIE_NAME", { infer: true })
    );
    if (!(await this.sessions.verifyOAuthState(stateCookie, query.state))) {
      throw new ApiError(400, "INVALID_OAUTH_STATE", "OAuth state is invalid or expired");
    }
    const accessToken = await this.discord.exchangeCode(query.code);
    const user = await this.discord.currentUser(accessToken);
    this.sessions.setSessionCookie(
      response,
      await this.sessions.createSession({
        id: user.id,
        username: user.username,
        globalName: user.global_name,
        avatar: user.avatar,
        accessToken
      })
    );
    await response.redirect(`${this.config.get("FRONTEND_URL", { infer: true })}/auth/callback`);
  }

  @Post("logout")
  @ApiOperation({ summary: "Log out", description: "Clears the session and OAuth state cookies." })
  @ApiSchemaResponse(successResponseSchema)
  public logout(@Res({ passthrough: true }) response: FastifyReply): { success: true } {
    this.sessions.clearCookies(response);
    return { success: true };
  }

  @Get("me")
  @UseGuards(SessionGuard)
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ summary: "Get the current user" })
  @ApiSchemaResponse(sessionUserResponseSchema)
  @ApiErrors(401)
  public async me(@Req() request: AuthenticatedRequest) {
    const user = request.user;
    return {
      id: user.id,
      username: user.username,
      globalName: user.globalName,
      avatarUrl: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=128`
        : null,
      isGlobalAdmin: await this.adminAccess.isAdmin(user.id)
    };
  }
}

@Controller("bot")
@ApiTags("Bot")
export class BotController {
  public constructor(private readonly discord: DiscordApiService) {}

  @Get("invite-url")
  @ApiOperation({ summary: "Get the Discord bot invite URL" })
  @ApiSchemaResponse(inviteUrlResponseSchema)
  public inviteUrl(): { url: string } {
    return { url: this.discord.inviteUrl() };
  }
}

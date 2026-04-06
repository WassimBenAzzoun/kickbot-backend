import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../config/env";
import { toAuthUserDto } from "../dto/authDto";
import { createAuthGuard } from "../middleware/authGuard";
import { DiscordApiService } from "../services/discordApiService";
import { ApiError } from "../services/errors";
import { SessionService } from "../services/sessionService";
import { parseWithZod } from "../services/validation";

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional()
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const discordApiService = new DiscordApiService();
  const sessionService = new SessionService();
  const requireAuth = createAuthGuard(sessionService);

  fastify.get("/auth/discord/login", async (request, reply) => {
    const state = sessionService.generateOauthState();
    sessionService.setOauthStateCookie(reply, state);

    const loginUrl = discordApiService.buildLoginUrl(state);
    await reply.redirect(loginUrl);
  });

  fastify.get("/auth/discord/callback", async (request, reply) => {
    const query = parseWithZod(
      callbackQuerySchema,
      request.query,
      "Invalid OAuth callback query"
    );

    if (query.error) {
      throw new ApiError(400, query.error_description ?? "Discord OAuth authorization failed");
    }

    if (!query.code || !query.state) {
      throw new ApiError(400, "Missing OAuth code or state");
    }

    const expectedState = sessionService.readOauthState(request);
    if (!expectedState || expectedState !== query.state) {
      sessionService.clearOauthStateCookie(reply);
      throw new ApiError(400, "Invalid OAuth state");
    }

    const tokenResponse = await discordApiService.exchangeCodeForToken(query.code);
    const discordUser = await discordApiService.fetchCurrentUser(tokenResponse.accessToken);

    sessionService.setSessionCookie(reply, {
      userId: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.globalName,
      avatar: discordUser.avatar,
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      accessTokenExpiresAt: Date.now() + tokenResponse.expiresIn * 1000
    });

    sessionService.clearOauthStateCookie(reply);

    const redirectUrl = new URL(env.FRONTEND_URL);
    redirectUrl.pathname = "/auth/callback";
    redirectUrl.searchParams.set("status", "success");

    await reply.redirect(redirectUrl.toString());
  });

  fastify.post("/auth/logout", async (_request, reply) => {
    sessionService.clearSessionCookie(reply);
    await reply.code(200).send({ success: true });
  });

  fastify.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    const session = request.session!;
    const isGlobalAdmin = await fastify.appContext.globalAdminService.isGlobalAdmin(session.userId);

    return {
      authenticated: true,
      user: toAuthUserDto(session, isGlobalAdmin)
    };
  });
};
